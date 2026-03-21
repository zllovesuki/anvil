import { BranchName } from "@/contracts";
import { describe, expect, it } from "vitest";

import { readProjectDoRows } from "../../../helpers/runtime";
import { registerWorkerRuntimeHooks } from "../../../helpers/worker-hooks";

import {
  buildGitHubRepository,
  buildGitLabProjectPayload,
  buildGitLabRepositoryPayload,
  createOwnedProjectContext,
  patchProject,
  postPublicWebhook,
  putWebhook,
  signGitHubPayload,
  signGiteaPayload,
} from "../helpers";
import { AFTER_SHA, BEFORE_SHA, THIRD_SHA, fillProjectQueueToCapacity, freeOneQueuedSlot } from "../public-helpers";

describe("webhook public routes", () => {
  registerWorkerRuntimeHooks();

  describe("redelivery and queue pressure", () => {
    it("returns 200 for GitLab queue_full and accepts a later redelivery with the same delivery id", async () => {
      const context = await createOwnedProjectContext({
        user: {
          email: "webhook-public-gitlab-queue@example.com",
          slug: "webhook-public-gitlab-queue",
        },
        project: {
          projectSlug: "gitlab-queue-project",
          repoUrl: "https://gitlab.com/example/gitlab-queue-project",
        },
      });

      await putWebhook(context.sessionId, context.project.id, "gitlab", {
        enabled: true,
        config: null,
        secret: "gitlab-queue-secret",
      });

      await fillProjectQueueToCapacity({
        projectId: context.project.id,
        userId: context.user.id,
        branch: context.project.defaultBranch,
      });

      const body = JSON.stringify({
        object_kind: "push",
        event_name: "push",
        ref: "refs/heads/main",
        before: AFTER_SHA,
        after: THIRD_SHA,
        checkout_sha: THIRD_SHA,
        project: buildGitLabProjectPayload(context.project.repoUrl, context.project.defaultBranch),
        repository: buildGitLabRepositoryPayload(context.project.repoUrl),
      });
      const headers = {
        "content-type": "application/json; charset=utf-8",
        "x-gitlab-event": "Push Hook",
        "x-gitlab-token": "gitlab-queue-secret",
        "x-gitlab-instance": "https://gitlab.com",
        "idempotency-key": "gitlab-delivery-queue-full",
      };

      const queueFull = await postPublicWebhook("gitlab", context.project, body, headers);
      expect(queueFull.status).toBe(200);
      expect(queueFull.response.headers.get("retry-after")).toBeNull();

      const afterQueueFull = await readProjectDoRows(context.project.id);
      expect(afterQueueFull.runs).toHaveLength(20);
      expect(afterQueueFull.webhookDeliveries).toHaveLength(1);
      expect(afterQueueFull.webhookDeliveries[0]?.outcome).toBe("queue_full");
      expect(afterQueueFull.webhookDeliveries[0]?.runId).toBeNull();

      const firstRunId = afterQueueFull.runs[0]?.runId;
      expect(firstRunId).toBeTruthy();
      await freeOneQueuedSlot(context.project.id, firstRunId!);

      const retried = await postPublicWebhook("gitlab", context.project, body, headers);
      expect(retried.status).toBe(202);

      const rows = await readProjectDoRows(context.project.id);
      expect(rows.runs).toHaveLength(21);
      expect(rows.webhookDeliveries).toHaveLength(1);
      expect(rows.webhookDeliveries[0]?.outcome).toBe("accepted");
      expect(rows.webhookDeliveries[0]?.deliveryId).toBe("gitlab-delivery-queue-full");
      expect(rows.webhookDeliveries[0]?.runId).toEqual(expect.any(String));
      expect(
        rows.runs.some((row) => row.provider === "gitlab" && row.deliveryId === "gitlab-delivery-queue-full"),
      ).toBe(true);
    });

    it("returns 503 for queue_full and accepts a later GitHub redelivery with the same delivery id", async () => {
      const context = await createOwnedProjectContext({
        user: {
          email: "webhook-public-github-queue@example.com",
          slug: "webhook-public-github-queue",
        },
        project: {
          projectSlug: "github-queue-project",
          repoUrl: "https://github.com/example/github-queue-project",
        },
      });

      await putWebhook(context.sessionId, context.project.id, "github", {
        enabled: true,
        secret: "github-queue-secret",
      });

      await fillProjectQueueToCapacity({
        projectId: context.project.id,
        userId: context.user.id,
        branch: context.project.defaultBranch,
      });

      const body = JSON.stringify({
        ref: "refs/heads/main",
        before: AFTER_SHA,
        after: THIRD_SHA,
        head_commit: {
          id: THIRD_SHA,
        },
        repository: buildGitHubRepository(context.project.repoUrl, context.project.defaultBranch),
      });
      const headers = {
        "content-type": "application/json; charset=utf-8",
        "x-github-event": "push",
        "x-github-delivery": "github-delivery-queue-full",
        "x-hub-signature-256": await signGitHubPayload("github-queue-secret", body),
      };

      const queueFull = await postPublicWebhook("github", context.project, body, headers);
      expect(queueFull.status).toBe(503);
      expect(queueFull.response.headers.get("retry-after")).toBe("60");

      const afterQueueFull = await readProjectDoRows(context.project.id);
      expect(afterQueueFull.runs).toHaveLength(20);
      expect(afterQueueFull.webhookDeliveries).toHaveLength(1);
      expect(afterQueueFull.webhookDeliveries[0]?.outcome).toBe("queue_full");
      expect(afterQueueFull.webhookDeliveries[0]?.runId).toBeNull();

      const firstRunId = afterQueueFull.runs[0]?.runId;
      expect(firstRunId).toBeTruthy();
      await freeOneQueuedSlot(context.project.id, firstRunId!);

      const retried = await postPublicWebhook("github", context.project, body, headers);
      expect(retried.status).toBe(202);

      const rows = await readProjectDoRows(context.project.id);
      expect(rows.runs).toHaveLength(21);
      expect(rows.webhookDeliveries).toHaveLength(1);
      expect(rows.webhookDeliveries[0]?.outcome).toBe("accepted");
      expect(rows.webhookDeliveries[0]?.deliveryId).toBe("github-delivery-queue-full");
      expect(rows.webhookDeliveries[0]?.runId).toEqual(expect.any(String));
      expect(
        rows.runs.some((row) => row.provider === "github" && row.deliveryId === "github-delivery-queue-full"),
      ).toBe(true);
    });

    it("returns 503 for Gitea queue_full and accepts a later redelivery with the same delivery id", async () => {
      const context = await createOwnedProjectContext({
        user: {
          email: "webhook-public-gitea-queue@example.com",
          slug: "webhook-public-gitea-queue",
        },
        project: {
          projectSlug: "gitea-queue-project",
          repoUrl: "https://gitea.example.com:8443/git/example/gitea-queue-project",
        },
      });

      await putWebhook(context.sessionId, context.project.id, "gitea", {
        enabled: true,
        config: {
          instanceUrl: "https://gitea.example.com:8443/git",
        },
        secret: "gitea-queue-secret",
      });

      await fillProjectQueueToCapacity({
        projectId: context.project.id,
        userId: context.user.id,
        branch: context.project.defaultBranch,
      });

      const body = JSON.stringify({
        ref: "refs/heads/main",
        before: AFTER_SHA,
        after: THIRD_SHA,
        repository: {
          clone_url: `${context.project.repoUrl}.git`,
          default_branch: context.project.defaultBranch,
        },
      });
      const signature = await signGiteaPayload("gitea-queue-secret", body);
      const deliveryId = "gitea-delivery-queue-full";
      const headers = {
        "content-type": "application/json; charset=utf-8",
        "x-gitea-event": "push",
        "x-gitea-delivery": deliveryId,
        "x-gitea-signature": signature,
      };

      const queueFull = await postPublicWebhook("gitea", context.project, body, headers);
      expect(queueFull.status).toBe(503);
      expect(queueFull.response.headers.get("retry-after")).toBe("60");

      const afterQueueFull = await readProjectDoRows(context.project.id);
      expect(afterQueueFull.runs).toHaveLength(20);
      expect(afterQueueFull.webhookDeliveries).toHaveLength(1);
      expect(afterQueueFull.webhookDeliveries[0]?.outcome).toBe("queue_full");
      expect(afterQueueFull.webhookDeliveries[0]?.runId).toBeNull();

      const firstRunId = afterQueueFull.runs[0]?.runId;
      expect(firstRunId).toBeTruthy();
      await freeOneQueuedSlot(context.project.id, firstRunId!);

      const retried = await postPublicWebhook("gitea", context.project, body, headers);
      expect(retried.status).toBe(202);

      const rows = await readProjectDoRows(context.project.id);
      expect(rows.runs).toHaveLength(21);
      expect(rows.webhookDeliveries).toHaveLength(1);
      expect(rows.webhookDeliveries[0]?.outcome).toBe("accepted");
      expect(rows.webhookDeliveries[0]?.deliveryId).toBe(deliveryId);
      expect(rows.webhookDeliveries[0]?.runId).toEqual(expect.any(String));
      expect(rows.runs.some((row) => row.provider === "gitea" && row.deliveryId === deliveryId)).toBe(true);
    });

    it("replays a stored queue_full GitHub delivery instead of overwriting it after branch drift", async () => {
      const context = await createOwnedProjectContext({
        user: {
          email: "webhook-public-github-queue-replay@example.com",
          slug: "webhook-public-github-queue-replay",
        },
        project: {
          projectSlug: "github-queue-replay-project",
          repoUrl: "https://github.com/example/github-queue-replay-project",
        },
      });

      await putWebhook(context.sessionId, context.project.id, "github", {
        enabled: true,
        secret: "github-queue-replay-secret",
      });

      await fillProjectQueueToCapacity({
        projectId: context.project.id,
        userId: context.user.id,
        branch: context.project.defaultBranch,
      });

      const body = JSON.stringify({
        ref: "refs/heads/main",
        before: AFTER_SHA,
        after: THIRD_SHA,
        head_commit: {
          id: THIRD_SHA,
        },
        repository: buildGitHubRepository(context.project.repoUrl, context.project.defaultBranch),
      });
      const headers = {
        "content-type": "application/json; charset=utf-8",
        "x-github-event": "push",
        "x-github-delivery": "github-delivery-queue-replay",
        "x-hub-signature-256": await signGitHubPayload("github-queue-replay-secret", body),
      };

      const queueFull = await postPublicWebhook("github", context.project, body, headers);
      expect(queueFull.status).toBe(503);
      expect(queueFull.response.headers.get("retry-after")).toBe("60");

      const afterQueueFull = await readProjectDoRows(context.project.id);
      expect(afterQueueFull.webhookDeliveries).toHaveLength(1);
      expect(afterQueueFull.webhookDeliveries[0]?.outcome).toBe("queue_full");

      const firstRunId = afterQueueFull.runs[0]?.runId;
      expect(firstRunId).toBeTruthy();
      await freeOneQueuedSlot(context.project.id, firstRunId!);

      const drifted = await patchProject(context.sessionId, context.project.id, {
        defaultBranch: BranchName.assertDecode("develop"),
      });
      expect(drifted.status).toBe(200);

      const retried = await postPublicWebhook("github", context.project, body, headers);
      expect(retried.status).toBe(503);
      expect(retried.response.headers.get("retry-after")).toBe("60");

      const rows = await readProjectDoRows(context.project.id);
      expect(rows.runs).toHaveLength(20);
      expect(rows.webhookDeliveries).toHaveLength(1);
      expect(rows.webhookDeliveries[0]?.deliveryId).toBe("github-delivery-queue-replay");
      expect(rows.webhookDeliveries[0]?.outcome).toBe("queue_full");
    });
  });
});
