import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import * as projectDoSchema from "@/worker/db/durable/schema/project-do";
import type { ProjectDoContext } from "@/worker/durable/project-do/types";
import { getProjectStub, readProjectDoRows, runInProjectDo } from "../../../helpers/runtime";
import { registerWorkerRuntimeHooks } from "../../../helpers/worker-hooks";

import {
  buildGitHubRepository,
  createOwnedProjectContext,
  deleteWebhook,
  getWebhooks,
  patchProject,
  postPublicWebhook,
  putWebhook,
  rotateWebhookSecret,
  signGitHubPayload,
} from "../helpers";
import { AFTER_SHA, BEFORE_SHA, buildVerifiedPushDeliveryInput } from "../public-helpers";

describe("webhook public routes", () => {
  registerWorkerRuntimeHooks();

  describe("webhook lifecycle behavior", () => {
    it("invalidates the old secret immediately after rotation", async () => {
      const context = await createOwnedProjectContext({
        user: {
          email: "webhook-public-github-rotate@example.com",
          slug: "webhook-public-github-rotate",
        },
        project: {
          projectSlug: "github-rotate-project",
          repoUrl: "https://github.com/example/github-rotate-project",
        },
      });

      await putWebhook(context.sessionId, context.project.id, "github", {
        enabled: true,
        secret: "github-rotate-secret-old",
      });

      const rotated = await rotateWebhookSecret(context.sessionId, context.project.id, "github");
      expect(rotated.status).toBe(200);
      expect(rotated.body?.secret).toEqual(expect.any(String));

      const body = JSON.stringify({
        ref: "refs/heads/main",
        before: BEFORE_SHA,
        after: AFTER_SHA,
        head_commit: {
          id: AFTER_SHA,
        },
        repository: buildGitHubRepository(context.project.repoUrl, context.project.defaultBranch),
      });

      const oldSecretResponse = await postPublicWebhook("github", context.project, body, {
        "content-type": "application/json; charset=utf-8",
        "x-github-event": "push",
        "x-github-delivery": "github-rotate-old-secret",
        "x-hub-signature-256": await signGitHubPayload("github-rotate-secret-old", body),
      });
      expect(oldSecretResponse.status).toBe(401);

      const newSecretResponse = await postPublicWebhook("github", context.project, body, {
        "content-type": "application/json; charset=utf-8",
        "x-github-event": "push",
        "x-github-delivery": "github-rotate-new-secret",
        "x-hub-signature-256": await signGitHubPayload(rotated.body!.secret, body),
      });
      expect(newSecretResponse.status).toBe(202);

      const rows = await readProjectDoRows(context.project.id);
      expect(rows.runs).toHaveLength(1);
      expect(rows.webhookDeliveries).toHaveLength(1);
      expect(rows.webhookDeliveries[0]?.deliveryId).toBe("github-rotate-new-secret");
    });

    it("preserves delivery audit and dedupe state when a webhook is deleted and recreated", async () => {
      const context = await createOwnedProjectContext({
        user: {
          email: "webhook-public-github-delete-recreate@example.com",
          slug: "webhook-public-github-delete-recreate",
        },
        project: {
          projectSlug: "github-delete-recreate-project",
          repoUrl: "https://github.com/example/github-delete-recreate-project",
        },
      });

      await putWebhook(context.sessionId, context.project.id, "github", {
        enabled: true,
        secret: "github-delete-recreate-secret-a",
      });

      const deliveryBody = JSON.stringify({
        ref: "refs/heads/main",
        before: BEFORE_SHA,
        after: AFTER_SHA,
        repository: buildGitHubRepository(context.project.repoUrl, context.project.defaultBranch),
      });

      const firstDelivery = await postPublicWebhook("github", context.project, deliveryBody, {
        "content-type": "application/json; charset=utf-8",
        "x-github-event": "push",
        "x-github-delivery": "github-delete-recreate-delivery",
        "x-hub-signature-256": await signGitHubPayload("github-delete-recreate-secret-a", deliveryBody),
      });
      expect(firstDelivery.status).toBe(202);

      const beforeDelete = await readProjectDoRows(context.project.id);
      expect(beforeDelete.runs).toHaveLength(1);
      expect(beforeDelete.webhooks).toHaveLength(1);
      expect(beforeDelete.webhookDeliveries).toHaveLength(1);

      const deleted = await deleteWebhook(context.sessionId, context.project.id, "github");
      expect(deleted.status).toBe(204);

      const afterDelete = await readProjectDoRows(context.project.id);
      expect(afterDelete.webhooks).toEqual([]);
      expect(afterDelete.webhookDeliveries).toHaveLength(1);
      expect(afterDelete.webhookDeliveries[0]?.deliveryId).toBe("github-delete-recreate-delivery");
      expect(afterDelete.webhookDeliveries[0]?.outcome).toBe("accepted");

      await putWebhook(context.sessionId, context.project.id, "github", {
        enabled: true,
        secret: "github-delete-recreate-secret-b",
      });

      const secondDelivery = await postPublicWebhook("github", context.project, deliveryBody, {
        "content-type": "application/json; charset=utf-8",
        "x-github-event": "push",
        "x-github-delivery": "github-delete-recreate-delivery",
        "x-hub-signature-256": await signGitHubPayload("github-delete-recreate-secret-b", deliveryBody),
      });
      expect(secondDelivery.status).toBe(200);

      const rows = await readProjectDoRows(context.project.id);
      expect(rows.runs).toHaveLength(1);
      expect(rows.runs.filter((row) => row.deliveryId === "github-delete-recreate-delivery")).toHaveLength(1);
      expect(rows.webhooks).toHaveLength(1);
      expect(rows.webhookDeliveries).toHaveLength(1);
      expect(rows.webhookDeliveries[0]?.deliveryId).toBe("github-delete-recreate-delivery");
      expect(rows.webhookDeliveries[0]?.outcome).toBe("accepted");

      const listed = await getWebhooks(context.sessionId, context.project.id);
      expect(listed.status).toBe(200);
      expect(listed.body?.webhooks).toHaveLength(1);
      expect(listed.body?.webhooks[0]?.recentDeliveries).toHaveLength(1);
      expect(listed.body?.webhooks[0]?.recentDeliveries[0]?.deliveryId).toBe("github-delete-recreate-delivery");
    });

    it("rejects stale verified deliveries after rotate, disable, or delete", async () => {
      const rotatedContext = await createOwnedProjectContext({
        user: {
          email: "webhook-public-stale-rotate@example.com",
          slug: "webhook-public-stale-rotate",
        },
        project: {
          projectSlug: "github-stale-rotate-project",
          repoUrl: "https://github.com/example/github-stale-rotate-project",
        },
      });

      await putWebhook(rotatedContext.sessionId, rotatedContext.project.id, "github", {
        enabled: true,
        secret: "github-stale-rotate-secret",
      });
      const rotatedStub = getProjectStub(rotatedContext.project.id);
      const rotatedMaterial = await rotatedStub.getWebhookVerificationMaterial(rotatedContext.project.id, "github");
      expect(rotatedMaterial).not.toBeNull();
      await rotateWebhookSecret(rotatedContext.sessionId, rotatedContext.project.id, "github");

      const rotatedResult = await runInProjectDo(
        rotatedContext.project.id,
        async (instance) =>
          await instance.recordVerifiedWebhookDelivery(
            buildVerifiedPushDeliveryInput({
              projectId: rotatedContext.project.id,
              repoUrl: rotatedContext.project.repoUrl,
              deliveryId: "github-stale-after-rotate",
              branch: rotatedContext.project.defaultBranch,
              verifiedWebhookUpdatedAt: rotatedMaterial!.updatedAt,
            }),
          ),
      );
      expect(rotatedResult.staleVerification).toBe(true);

      const rotatedRows = await readProjectDoRows(rotatedContext.project.id);
      expect(rotatedRows.runs).toEqual([]);
      expect(rotatedRows.webhookDeliveries).toEqual([]);

      const disabledContext = await createOwnedProjectContext({
        user: {
          email: "webhook-public-stale-disable@example.com",
          slug: "webhook-public-stale-disable",
        },
        project: {
          projectSlug: "github-stale-disable-project",
          repoUrl: "https://github.com/example/github-stale-disable-project",
        },
      });

      await putWebhook(disabledContext.sessionId, disabledContext.project.id, "github", {
        enabled: true,
        secret: "github-stale-disable-secret",
      });
      const disabledStub = getProjectStub(disabledContext.project.id);
      const disabledMaterial = await disabledStub.getWebhookVerificationMaterial(disabledContext.project.id, "github");
      expect(disabledMaterial).not.toBeNull();
      await putWebhook(disabledContext.sessionId, disabledContext.project.id, "github", {
        enabled: false,
      });

      const disabledResult = await runInProjectDo(
        disabledContext.project.id,
        async (instance) =>
          await instance.recordVerifiedWebhookDelivery(
            buildVerifiedPushDeliveryInput({
              projectId: disabledContext.project.id,
              repoUrl: disabledContext.project.repoUrl,
              deliveryId: "github-stale-after-disable",
              branch: disabledContext.project.defaultBranch,
              verifiedWebhookUpdatedAt: disabledMaterial!.updatedAt,
            }),
          ),
      );
      expect(disabledResult.staleVerification).toBe(true);

      const disabledRows = await readProjectDoRows(disabledContext.project.id);
      expect(disabledRows.runs).toEqual([]);
      expect(disabledRows.webhookDeliveries).toEqual([]);

      const deletedContext = await createOwnedProjectContext({
        user: {
          email: "webhook-public-stale-delete@example.com",
          slug: "webhook-public-stale-delete",
        },
        project: {
          projectSlug: "github-stale-delete-project",
          repoUrl: "https://github.com/example/github-stale-delete-project",
        },
      });

      await putWebhook(deletedContext.sessionId, deletedContext.project.id, "github", {
        enabled: true,
        secret: "github-stale-delete-secret",
      });
      const deletedStub = getProjectStub(deletedContext.project.id);
      const deletedMaterial = await deletedStub.getWebhookVerificationMaterial(deletedContext.project.id, "github");
      expect(deletedMaterial).not.toBeNull();
      await deleteWebhook(deletedContext.sessionId, deletedContext.project.id, "github");

      const deletedResult = await runInProjectDo(
        deletedContext.project.id,
        async (instance) =>
          await instance.recordVerifiedWebhookDelivery(
            buildVerifiedPushDeliveryInput({
              projectId: deletedContext.project.id,
              repoUrl: deletedContext.project.repoUrl,
              deliveryId: "github-stale-after-delete",
              branch: deletedContext.project.defaultBranch,
              verifiedWebhookUpdatedAt: deletedMaterial!.updatedAt,
            }),
          ),
      );
      expect(deletedResult.staleVerification).toBe(true);

      const deletedRows = await readProjectDoRows(deletedContext.project.id);
      expect(deletedRows.runs).toEqual([]);
      expect(deletedRows.webhookDeliveries).toEqual([]);
    });

    it("accepts deliveries after a non-material project update such as renaming", async () => {
      const context = await createOwnedProjectContext({
        user: {
          email: "webhook-public-non-material@example.com",
          slug: "webhook-public-non-material",
        },
        project: {
          projectSlug: "non-material-project",
          repoUrl: "https://github.com/example/non-material-project",
          name: "Original Name",
        },
      });

      await putWebhook(context.sessionId, context.project.id, "github", {
        enabled: true,
        secret: "non-material-secret",
      });

      const renamed = await patchProject(context.sessionId, context.project.id, {
        name: "Renamed Project",
      });
      expect(renamed.status).toBe(200);

      const body = JSON.stringify({
        ref: "refs/heads/main",
        before: BEFORE_SHA,
        after: AFTER_SHA,
        repository: buildGitHubRepository(context.project.repoUrl, context.project.defaultBranch),
      });

      const delivered = await postPublicWebhook("github", context.project, body, {
        "content-type": "application/json; charset=utf-8",
        "x-github-event": "push",
        "x-github-delivery": "github-after-rename",
        "x-hub-signature-256": await signGitHubPayload("non-material-secret", body),
      });
      expect(delivered.status).toBe(202);

      const rows = await readProjectDoRows(context.project.id);
      expect(rows.runs).toHaveLength(1);
      expect(rows.webhookDeliveries).toHaveLength(1);
      expect(rows.webhookDeliveries[0]?.outcome).toBe("accepted");
    });

    it("prunes webhook deliveries older than 72 hours on the next write", async () => {
      const context = await createOwnedProjectContext({
        user: { email: "webhook-prune@example.com", slug: "webhook-prune" },
        project: {
          projectSlug: "prune-project",
          repoUrl: "https://github.com/example/prune-project",
        },
      });

      const createResult = await putWebhook(context.sessionId, context.project.id, "github", {
        enabled: true,
        secret: "prune-secret",
      });
      expect(createResult.status).toBe(201);

      for (let i = 0; i < 3; i++) {
        const pingBody = JSON.stringify({
          zen: "keep it logically awesome",
          repository: buildGitHubRepository(context.project.repoUrl),
        });
        const pingResult = await postPublicWebhook("github", context.project, pingBody, {
          "content-type": "application/json; charset=utf-8",
          "x-github-event": "ping",
          "x-github-delivery": `prune-ping-${i}`,
          "x-hub-signature-256": await signGitHubPayload("prune-secret", pingBody),
        });
        expect(pingResult.status).toBe(200);
      }

      const before = await readProjectDoRows(context.project.id);
      expect(before.webhookDeliveries).toHaveLength(3);

      const expiredTimestamp = Date.now() - 73 * 60 * 60 * 1000;
      await runInProjectDo(context.project.id, async (instance) => {
        const { db } = instance as unknown as Pick<ProjectDoContext, "db">;
        for (const row of before.webhookDeliveries.slice(0, 2)) {
          db.update(projectDoSchema.projectWebhookDeliveries)
            .set({ receivedAt: expiredTimestamp })
            .where(eq(projectDoSchema.projectWebhookDeliveries.id, row.id))
            .run();
        }
      });

      const listed = await getWebhooks(context.sessionId, context.project.id);
      expect(listed.status).toBe(200);
      const midpoint = await readProjectDoRows(context.project.id);
      expect(midpoint.webhookDeliveries).toHaveLength(3);

      const updateResult = await putWebhook(context.sessionId, context.project.id, "github", {
        enabled: true,
      });
      expect(updateResult.status).toBe(200);

      const after = await readProjectDoRows(context.project.id);
      expect(after.webhookDeliveries).toHaveLength(1);
      expect(after.webhookDeliveries[0]?.deliveryId).toBe("prune-ping-2");
    });
  });
});
