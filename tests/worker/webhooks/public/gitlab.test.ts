import { describe, expect, it } from "vitest";

import { readProjectDoRows } from "../../../helpers/runtime";
import { registerWorkerRuntimeHooks } from "../../../helpers/worker-hooks";

import {
  buildGitLabProjectPayload,
  buildGitLabRepositoryPayload,
  createOwnedProjectContext,
  postPublicWebhook,
  putWebhook,
} from "../helpers";
import { AFTER_SHA, BEFORE_SHA } from "../public-helpers";

describe("webhook public routes", () => {
  registerWorkerRuntimeHooks();

  describe("GitLab deliveries", () => {
    it("accepts verified GitLab pushes with default gitlab.com config", async () => {
      const context = await createOwnedProjectContext({
        user: {
          email: "webhook-public-gitlab@example.com",
          slug: "webhook-public-gitlab",
        },
        project: {
          projectSlug: "gitlab-public-project",
          repoUrl: "https://gitlab.com/example/gitlab-public-project",
        },
      });

      await putWebhook(context.sessionId, context.project.id, "gitlab", {
        enabled: true,
        config: null,
        secret: "gitlab-secret",
      });

      const body = JSON.stringify({
        object_kind: "push",
        event_name: "push",
        ref: "refs/heads/main",
        before: BEFORE_SHA,
        after: AFTER_SHA,
        checkout_sha: AFTER_SHA,
        project: buildGitLabProjectPayload(context.project.repoUrl, context.project.defaultBranch),
        repository: buildGitLabRepositoryPayload(context.project.repoUrl),
      });

      const accepted = await postPublicWebhook("gitlab", context.project, body, {
        "content-type": "application/json; charset=utf-8",
        "x-gitlab-event": "Push Hook",
        "x-gitlab-token": "gitlab-secret",
        "x-gitlab-instance": "https://gitlab.com",
        "idempotency-key": "gitlab-delivery-accepted",
      });
      expect(accepted.status).toBe(202);

      const rows = await readProjectDoRows(context.project.id);
      expect(rows.runs).toHaveLength(1);
      expect(rows.runs[0]?.provider).toBe("gitlab");
      expect(rows.runs[0]?.deliveryId).toBe("gitlab-delivery-accepted");
      expect(rows.runs[0]?.branch).toBe("main");
      expect(rows.runs[0]?.commitSha).toBe(AFTER_SHA);
      expect(rows.webhookDeliveries).toHaveLength(1);
      expect(rows.webhookDeliveries[0]?.outcome).toBe("accepted");
    });

    it("accepts verified GitLab pushes for self-hosted instances with fallback delivery id headers", async () => {
      const context = await createOwnedProjectContext({
        user: {
          email: "webhook-public-gitlab-self-hosted@example.com",
          slug: "webhook-public-gitlab-self-hosted",
        },
        project: {
          projectSlug: "gitlab-self-hosted-project",
          repoUrl: "https://gitlab.example.com/example/gitlab-self-hosted-project",
        },
      });

      await putWebhook(context.sessionId, context.project.id, "gitlab", {
        enabled: true,
        config: {
          instanceUrl: "https://gitlab.example.com",
        },
        secret: "gitlab-self-hosted-secret",
      });

      const body = JSON.stringify({
        object_kind: "push",
        event_name: "push",
        ref: "refs/heads/main",
        before: BEFORE_SHA,
        after: AFTER_SHA,
        checkout_sha: AFTER_SHA,
        project: buildGitLabProjectPayload(context.project.repoUrl, context.project.defaultBranch),
        repository: buildGitLabRepositoryPayload(context.project.repoUrl),
      });

      const accepted = await postPublicWebhook("gitlab", context.project, body, {
        "content-type": "application/json; charset=utf-8",
        "x-gitlab-event": "Push Hook",
        "x-gitlab-token": "gitlab-self-hosted-secret",
        "x-gitlab-event-uuid": "gitlab-self-hosted-delivery",
      });
      expect(accepted.status).toBe(202);

      const rows = await readProjectDoRows(context.project.id);
      expect(rows.runs).toHaveLength(1);
      expect(rows.runs[0]?.provider).toBe("gitlab");
      expect(rows.runs[0]?.deliveryId).toBe("gitlab-self-hosted-delivery");
      expect(rows.runs[0]?.branch).toBe("main");
      expect(rows.runs[0]?.commitSha).toBe(AFTER_SHA);
      expect(rows.webhookDeliveries).toHaveLength(1);
      expect(rows.webhookDeliveries[0]?.outcome).toBe("accepted");
      expect(rows.webhookDeliveries[0]?.repoUrl).toBe(context.project.repoUrl);
    });

    it("records GitLab system hooks as ignored_event without creating a run", async () => {
      const context = await createOwnedProjectContext({
        user: {
          email: "webhook-public-gitlab-system-hook@example.com",
          slug: "webhook-public-gitlab-system-hook",
        },
        project: {
          projectSlug: "gitlab-system-hook-project",
          repoUrl: "https://gitlab.com/example/gitlab-system-hook-project",
        },
      });

      await putWebhook(context.sessionId, context.project.id, "gitlab", {
        enabled: true,
        config: null,
        secret: "gitlab-system-hook-secret",
      });

      const body = JSON.stringify({
        object_kind: "system_hook",
        event_name: "project_create",
        project: buildGitLabProjectPayload(context.project.repoUrl, context.project.defaultBranch),
        repository: buildGitLabRepositoryPayload(context.project.repoUrl),
      });

      const response = await postPublicWebhook("gitlab", context.project, body, {
        "content-type": "application/json; charset=utf-8",
        "x-gitlab-event": "System Hook",
        "x-gitlab-token": "gitlab-system-hook-secret",
        "idempotency-key": "gitlab-system-hook-delivery",
      });
      expect(response.status).toBe(200);

      const rows = await readProjectDoRows(context.project.id);
      expect(rows.runs).toHaveLength(0);
      expect(rows.webhookDeliveries).toHaveLength(1);
      expect(rows.webhookDeliveries[0]?.eventName).toBe("System Hook");
      expect(rows.webhookDeliveries[0]?.outcome).toBe("ignored_event");
    });

    it("records GitLab non-push events as ignored_event", async () => {
      const context = await createOwnedProjectContext({
        user: {
          email: "webhook-public-gitlab-events@example.com",
          slug: "webhook-public-gitlab-events",
        },
        project: {
          projectSlug: "gitlab-events-project",
          repoUrl: "https://gitlab.com/example/gitlab-events-project",
        },
      });

      await putWebhook(context.sessionId, context.project.id, "gitlab", {
        enabled: true,
        secret: "gitlab-events-secret",
      });

      const mergeRequestBody = JSON.stringify({
        object_kind: "merge_request",
        event_name: "merge_request",
        project: buildGitLabProjectPayload(context.project.repoUrl),
        repository: buildGitLabRepositoryPayload(context.project.repoUrl),
      });
      const mergeRequestResponse = await postPublicWebhook("gitlab", context.project, mergeRequestBody, {
        "content-type": "application/json; charset=utf-8",
        "x-gitlab-event": "Merge Request Hook",
        "x-gitlab-token": "gitlab-events-secret",
        "idempotency-key": "gitlab-merge-request-delivery",
      });
      expect(mergeRequestResponse.status).toBe(200);

      const tagPushBody = JSON.stringify({
        object_kind: "tag_push",
        event_name: "tag_push",
        ref: "refs/tags/v1.0.0",
        project: buildGitLabProjectPayload(context.project.repoUrl),
        repository: buildGitLabRepositoryPayload(context.project.repoUrl),
      });
      const tagPushResponse = await postPublicWebhook("gitlab", context.project, tagPushBody, {
        "content-type": "application/json; charset=utf-8",
        "x-gitlab-event": "Tag Push Hook",
        "x-gitlab-token": "gitlab-events-secret",
        "idempotency-key": "gitlab-tag-push-delivery",
      });
      expect(tagPushResponse.status).toBe(200);

      const rows = await readProjectDoRows(context.project.id);
      expect(rows.runs).toHaveLength(0);
      expect(rows.webhookDeliveries).toHaveLength(2);
      expect(rows.webhookDeliveries.every((row) => row.outcome === "ignored_event")).toBe(true);
    });
  });
});
