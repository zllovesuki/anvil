import { describe, expect, it } from "vitest";

import { readProjectDoRows } from "../../../helpers/runtime";
import { registerWorkerRuntimeHooks } from "../../../helpers/worker-hooks";

import {
  buildGitHubRepository,
  createOwnedProjectContext,
  getWebhooks,
  postPublicWebhook,
  putWebhook,
  signGitHubPayload,
} from "../helpers";
import { AFTER_SHA, BEFORE_SHA } from "../public-helpers";

describe("webhook public routes", () => {
  registerWorkerRuntimeHooks();

  describe("GitHub deliveries", () => {
    it("accepts verified GitHub pushes and replays duplicates without creating a second run", async () => {
      const context = await createOwnedProjectContext({
        user: {
          email: "webhook-public-github@example.com",
          slug: "webhook-public-github",
        },
        project: {
          projectSlug: "github-public-project",
          repoUrl: "https://github.com/example/github-public-project",
        },
      });

      const createWebhook = await putWebhook(context.sessionId, context.project.id, "github", {
        enabled: true,
        secret: "github-secret",
      });
      expect([200, 201]).toContain(createWebhook.status);

      const body = JSON.stringify({
        ref: "refs/heads/main",
        before: BEFORE_SHA,
        after: AFTER_SHA,
        head_commit: {
          id: AFTER_SHA,
        },
        repository: buildGitHubRepository(context.project.repoUrl, context.project.defaultBranch),
      });

      const headers = {
        "content-type": "application/json; charset=utf-8",
        "x-github-event": "push",
        "x-github-delivery": "github-delivery-accepted",
        "x-hub-signature-256": await signGitHubPayload("github-secret", body),
      };

      const accepted = await postPublicWebhook("github", context.project, body, headers);
      expect(accepted.status).toBe(202);

      const duplicated = await postPublicWebhook("github", context.project, body, headers);
      expect(duplicated.status).toBe(200);

      const rows = await readProjectDoRows(context.project.id);
      expect(rows.runs).toHaveLength(1);
      expect(rows.runs[0]?.triggerType).toBe("webhook");
      expect(rows.runs[0]?.provider).toBe("github");
      expect(rows.runs[0]?.deliveryId).toBe("github-delivery-accepted");
      expect(rows.runs[0]?.branch).toBe("main");
      expect(rows.runs[0]?.commitSha).toBe(AFTER_SHA);
      expect(rows.webhookDeliveries).toHaveLength(1);
      expect(rows.webhookDeliveries[0]?.outcome).toBe("accepted");

      const listed = await getWebhooks(context.sessionId, context.project.id);
      expect(listed.status).toBe(200);
      expect(listed.body?.webhooks).toHaveLength(1);
      expect(listed.body?.webhooks[0]?.recentDeliveries).toHaveLength(1);
      expect(listed.body?.webhooks[0]?.recentDeliveries[0]).toMatchObject({
        provider: "github",
        deliveryId: "github-delivery-accepted",
        outcome: "accepted",
        branch: "main",
        commitSha: AFTER_SHA,
      });
    });

    it("accepts GitHub pushes when the stored repo URL casing differs from the delivery payload", async () => {
      const context = await createOwnedProjectContext({
        user: {
          email: "webhook-public-github-mixed-case@example.com",
          slug: "webhook-public-github-mixed-case",
        },
        project: {
          projectSlug: "github-mixed-case-project",
          repoUrl: "https://github.com/Example/Mixed-Case-Project",
        },
      });

      await putWebhook(context.sessionId, context.project.id, "github", {
        enabled: true,
        secret: "github-mixed-case-secret",
      });

      const payloadRepoUrl = "https://github.com/example/mixed-case-project";
      const body = JSON.stringify({
        ref: "refs/heads/main",
        before: BEFORE_SHA,
        after: AFTER_SHA,
        repository: buildGitHubRepository(payloadRepoUrl, context.project.defaultBranch),
      });

      const accepted = await postPublicWebhook("github", context.project, body, {
        "content-type": "application/json; charset=utf-8",
        "x-github-event": "push",
        "x-github-delivery": "github-mixed-case-delivery",
        "x-hub-signature-256": await signGitHubPayload("github-mixed-case-secret", body),
      });
      expect(accepted.status).toBe(202);

      const rows = await readProjectDoRows(context.project.id);
      expect(rows.runs).toHaveLength(1);
      expect(rows.runs[0]?.deliveryId).toBe("github-mixed-case-delivery");
      expect(rows.webhookDeliveries).toHaveLength(1);
      expect(rows.webhookDeliveries[0]?.outcome).toBe("accepted");
      expect(rows.webhookDeliveries[0]?.repoUrl).toBe(payloadRepoUrl);

      const listed = await getWebhooks(context.sessionId, context.project.id);
      expect(listed.status).toBe(200);
      expect(listed.body?.webhooks[0]?.recentDeliveries[0]?.repoUrl).toBe(payloadRepoUrl);
    });

    it("records ignored GitHub events, ignored branches, and caps recent deliveries at ten", async () => {
      const context = await createOwnedProjectContext({
        user: {
          email: "webhook-public-github-ignored@example.com",
          slug: "webhook-public-github-ignored",
        },
        project: {
          projectSlug: "github-ignored-project",
          repoUrl: "https://github.com/example/github-ignored-project",
        },
      });

      await putWebhook(context.sessionId, context.project.id, "github", {
        enabled: true,
        secret: "github-ignored-secret",
      });

      const issuesBody = JSON.stringify({
        action: "opened",
        issue: {
          number: 1,
        },
        repository: buildGitHubRepository(context.project.repoUrl, context.project.defaultBranch),
      });
      const issuesResponse = await postPublicWebhook("github", context.project, issuesBody, {
        "content-type": "application/json; charset=utf-8",
        "x-github-event": "issues",
        "x-github-delivery": "github-ignored-event",
        "x-hub-signature-256": await signGitHubPayload("github-ignored-secret", issuesBody),
      });
      expect(issuesResponse.status).toBe(200);

      const branchBody = JSON.stringify({
        ref: "refs/heads/feature-x",
        before: BEFORE_SHA,
        after: AFTER_SHA,
        head_commit: {
          id: AFTER_SHA,
        },
        repository: buildGitHubRepository(context.project.repoUrl, context.project.defaultBranch),
      });
      const branchResponse = await postPublicWebhook("github", context.project, branchBody, {
        "content-type": "application/json; charset=utf-8",
        "x-github-event": "push",
        "x-github-delivery": "github-ignored-branch",
        "x-hub-signature-256": await signGitHubPayload("github-ignored-secret", branchBody),
      });
      expect(branchResponse.status).toBe(200);

      for (let index = 0; index < 12; index += 1) {
        const pingBody = JSON.stringify({
          zen: "keep it logically awesome",
          repository: buildGitHubRepository(context.project.repoUrl, context.project.defaultBranch),
        });
        const pingResponse = await postPublicWebhook("github", context.project, pingBody, {
          "content-type": "application/json; charset=utf-8",
          "x-github-event": "ping",
          "x-github-delivery": `github-ping-${index.toString().padStart(2, "0")}`,
          "x-hub-signature-256": await signGitHubPayload("github-ignored-secret", pingBody),
        });
        expect(pingResponse.status).toBe(200);
        await new Promise((resolve) => setTimeout(resolve, 2));
      }

      const rows = await readProjectDoRows(context.project.id);
      expect(rows.runs).toHaveLength(0);
      expect(rows.webhookDeliveries).toHaveLength(14);
      expect(rows.webhookDeliveries.some((row) => row.outcome === "ignored_event")).toBe(true);
      expect(rows.webhookDeliveries.some((row) => row.outcome === "ignored_branch")).toBe(true);
      expect(rows.webhookDeliveries.filter((row) => row.outcome === "ignored_ping")).toHaveLength(12);

      const listed = await getWebhooks(context.sessionId, context.project.id);
      expect(listed.status).toBe(200);
      expect(listed.body?.webhooks).toHaveLength(1);
      expect(listed.body?.webhooks[0]?.recentDeliveries).toHaveLength(10);
      expect(listed.body?.webhooks[0]?.recentDeliveries.every((delivery) => delivery.outcome === "ignored_ping")).toBe(
        true,
      );
    });
  });
});
