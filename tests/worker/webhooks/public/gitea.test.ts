import { describe, expect, it } from "vitest";

import { readProjectDoRows } from "../../../helpers/runtime";
import { registerWorkerRuntimeHooks } from "../../../helpers/worker-hooks";

import { createOwnedProjectContext, getWebhooks, postPublicWebhook, putWebhook, signGiteaPayload } from "../helpers";
import { AFTER_SHA, BEFORE_SHA } from "../public-helpers";

describe("webhook public routes", () => {
  registerWorkerRuntimeHooks();

  describe("Gitea deliveries", () => {
    it("accepts canonical Gitea repo URL variants with .git, trailing slash, public port, and path prefix", async () => {
      const context = await createOwnedProjectContext({
        user: {
          email: "webhook-public-gitea@example.com",
          slug: "webhook-public-gitea",
        },
        project: {
          projectSlug: "gitea-public-project",
          repoUrl: "https://gitea.example.com:8443/git/example/gitea-public-project",
        },
      });

      await putWebhook(context.sessionId, context.project.id, "gitea", {
        enabled: true,
        config: {
          instanceUrl: "https://gitea.example.com:8443/git",
        },
        secret: "gitea-secret",
      });

      const body = JSON.stringify({
        ref: "refs/heads/main",
        before: BEFORE_SHA,
        after: AFTER_SHA,
        repository: {
          clone_url: `${context.project.repoUrl}.git/`,
          default_branch: context.project.defaultBranch,
        },
      });

      const accepted = await postPublicWebhook("gitea", context.project, body, {
        "content-type": "application/json; charset=utf-8",
        "x-gitea-event": "push",
        "x-gitea-delivery": "gitea-delivery-accepted",
        "x-gitea-signature": await signGiteaPayload("gitea-secret", body),
      });
      expect(accepted.status).toBe(202);

      const rows = await readProjectDoRows(context.project.id);
      expect(rows.runs).toHaveLength(1);
      expect(rows.runs[0]?.provider).toBe("gitea");
      expect(rows.runs[0]?.deliveryId).toBe("gitea-delivery-accepted");
      expect(rows.runs[0]?.branch).toBe("main");
      expect(rows.runs[0]?.commitSha).toBe(AFTER_SHA);
      expect(rows.webhookDeliveries).toHaveLength(1);
      expect(rows.webhookDeliveries[0]?.repoUrl).toBe(context.project.repoUrl);
    });

    it("records Gitea non-push events as ignored_event", async () => {
      const context = await createOwnedProjectContext({
        user: {
          email: "webhook-public-gitea-events@example.com",
          slug: "webhook-public-gitea-events",
        },
        project: {
          projectSlug: "gitea-events-project",
          repoUrl: "https://gitea.example.com/example/gitea-events-project",
        },
      });

      await putWebhook(context.sessionId, context.project.id, "gitea", {
        enabled: true,
        config: {
          instanceUrl: "https://gitea.example.com",
        },
        secret: "gitea-events-secret",
      });

      const createBody = JSON.stringify({
        ref: "v1.0.0",
        ref_type: "tag",
        repository: {
          full_name: "example/gitea-events-project",
          clone_url: "https://gitea.example.com/example/gitea-events-project.git",
        },
      });
      const createResponse = await postPublicWebhook("gitea", context.project, createBody, {
        "content-type": "application/json; charset=utf-8",
        "x-gitea-event": "create",
        "x-gitea-delivery": "gitea-create-delivery",
        "x-gitea-signature": await signGiteaPayload("gitea-events-secret", createBody),
      });
      expect(createResponse.status).toBe(200);

      const pullRequestBody = JSON.stringify({
        action: "opened",
        number: 1,
        repository: {
          full_name: "example/gitea-events-project",
          clone_url: "https://gitea.example.com/example/gitea-events-project.git",
        },
      });
      const pullRequestResponse = await postPublicWebhook("gitea", context.project, pullRequestBody, {
        "content-type": "application/json; charset=utf-8",
        "x-gitea-event": "pull_request",
        "x-gitea-delivery": "gitea-pull-request-delivery",
        "x-gitea-signature": await signGiteaPayload("gitea-events-secret", pullRequestBody),
      });
      expect(pullRequestResponse.status).toBe(200);

      const rows = await readProjectDoRows(context.project.id);
      expect(rows.runs).toHaveLength(0);
      expect(rows.webhookDeliveries).toHaveLength(2);
      expect(rows.webhookDeliveries.every((row) => row.outcome === "ignored_event")).toBe(true);
      expect(rows.webhookDeliveries.find((row) => row.deliveryId === "gitea-create-delivery")?.ref).toBe("v1.0.0");

      const listed = await getWebhooks(context.sessionId, context.project.id);
      expect(listed.status).toBe(200);
      expect(
        listed.body?.webhooks[0]?.recentDeliveries.find((delivery) => delivery.deliveryId === "gitea-create-delivery")
          ?.ref,
      ).toBe("v1.0.0");
    });
  });
});
