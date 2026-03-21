import { describe, expect, it } from "vitest";

import { readProjectDoRows } from "../../../helpers/runtime";
import { registerWorkerRuntimeHooks } from "../../../helpers/worker-hooks";

import {
  buildGitHubRepository,
  buildGitLabProjectPayload,
  buildGitLabRepositoryPayload,
  createOwnedProjectContext,
  postPublicWebhook,
  putWebhook,
  signGitHubPayload,
} from "../helpers";
import { AFTER_SHA, BEFORE_SHA } from "../public-helpers";

describe("webhook public routes", () => {
  registerWorkerRuntimeHooks();

  describe("error handling", () => {
    it("returns expected public-route errors for missing or disabled webhooks, unsupported content types, and invalid JSON", async () => {
      const missingContext = await createOwnedProjectContext({
        user: {
          email: "webhook-public-missing@example.com",
          slug: "webhook-public-missing",
        },
        project: {
          projectSlug: "missing-webhook-project",
          repoUrl: "https://github.com/example/missing-webhook-project",
        },
      });

      const missingWebhook = await postPublicWebhook("github", missingContext.project, "{}", {
        "content-type": "application/json; charset=utf-8",
      });
      expect(missingWebhook.status).toBe(404);

      const disabledContext = await createOwnedProjectContext({
        user: {
          email: "webhook-public-disabled@example.com",
          slug: "webhook-public-disabled",
        },
        project: {
          projectSlug: "disabled-webhook-project",
          repoUrl: "https://github.com/example/disabled-webhook-project",
        },
      });

      await putWebhook(disabledContext.sessionId, disabledContext.project.id, "github", {
        enabled: false,
        secret: "disabled-webhook-secret",
      });

      const validPushBody = JSON.stringify({
        ref: "refs/heads/main",
        before: BEFORE_SHA,
        after: AFTER_SHA,
        repository: buildGitHubRepository(disabledContext.project.repoUrl, disabledContext.project.defaultBranch),
      });

      const disabledWebhook = await postPublicWebhook("github", disabledContext.project, validPushBody, {
        "content-type": "application/json; charset=utf-8",
        "x-github-event": "push",
        "x-github-delivery": "disabled-webhook-delivery",
        "x-hub-signature-256": await signGitHubPayload("disabled-webhook-secret", validPushBody),
      });
      expect(disabledWebhook.status).toBe(404);

      const unsupportedMediaType = await postPublicWebhook("github", disabledContext.project, validPushBody, {
        "content-type": "text/plain",
        "x-github-event": "push",
        "x-github-delivery": "unsupported-media-delivery",
        "x-hub-signature-256": await signGitHubPayload("disabled-webhook-secret", validPushBody),
      });
      expect(unsupportedMediaType.status).toBe(415);

      const invalidJsonContext = await createOwnedProjectContext({
        user: {
          email: "webhook-public-invalid-json@example.com",
          slug: "webhook-public-invalid-json",
        },
        project: {
          projectSlug: "invalid-json-project",
          repoUrl: "https://github.com/example/invalid-json-project",
        },
      });

      await putWebhook(invalidJsonContext.sessionId, invalidJsonContext.project.id, "github", {
        enabled: true,
        secret: "invalid-json-secret",
      });

      const invalidJsonBody = "{not-valid-json";
      const invalidJson = await postPublicWebhook("github", invalidJsonContext.project, invalidJsonBody, {
        "content-type": "application/json; charset=utf-8",
        "x-github-event": "push",
        "x-github-delivery": "invalid-json-delivery",
        "x-hub-signature-256": await signGitHubPayload("invalid-json-secret", invalidJsonBody),
      });
      expect(invalidJson.status).toBe(400);

      const invalidJsonBadSignature = await postPublicWebhook("github", invalidJsonContext.project, invalidJsonBody, {
        "content-type": "application/json; charset=utf-8",
        "x-github-event": "push",
        "x-github-delivery": "invalid-json-bad-signature-delivery",
        "x-hub-signature-256": await signGitHubPayload("wrong-invalid-json-secret", invalidJsonBody),
      });
      expect(invalidJsonBadSignature.status).toBe(401);

      const missingRows = await readProjectDoRows(missingContext.project.id);
      expect(missingRows.runs).toEqual([]);
      expect(missingRows.webhookDeliveries).toEqual([]);

      const disabledRows = await readProjectDoRows(disabledContext.project.id);
      expect(disabledRows.runs).toEqual([]);
      expect(disabledRows.webhookDeliveries).toEqual([]);

      const invalidJsonRows = await readProjectDoRows(invalidJsonContext.project.id);
      expect(invalidJsonRows.runs).toEqual([]);
      expect(invalidJsonRows.webhookDeliveries).toEqual([]);
    });

    it("rejects invalid signatures, repo mismatches, and missing headers without recording a delivery", async () => {
      const invalidSignatureContext = await createOwnedProjectContext({
        user: {
          email: "webhook-public-github-invalid@example.com",
          slug: "webhook-public-github-invalid",
        },
        project: {
          projectSlug: "github-invalid-project",
          repoUrl: "https://github.com/example/github-invalid-project",
        },
      });

      await putWebhook(invalidSignatureContext.sessionId, invalidSignatureContext.project.id, "github", {
        enabled: true,
        secret: "github-invalid-secret",
      });

      const validBody = JSON.stringify({
        ref: "refs/heads/main",
        before: BEFORE_SHA,
        after: AFTER_SHA,
        repository: buildGitHubRepository(
          invalidSignatureContext.project.repoUrl,
          invalidSignatureContext.project.defaultBranch,
        ),
      });

      const invalidSignature = await postPublicWebhook("github", invalidSignatureContext.project, validBody, {
        "content-type": "application/json; charset=utf-8",
        "x-github-event": "push",
        "x-github-delivery": "github-invalid-signature",
        "x-hub-signature-256": await signGitHubPayload("not-the-right-secret", validBody),
      });
      expect(invalidSignature.status).toBe(401);

      const repoMismatchContext = await createOwnedProjectContext({
        user: {
          email: "webhook-public-github-mismatch@example.com",
          slug: "webhook-public-github-mismatch",
        },
        project: {
          projectSlug: "github-mismatch-project",
          repoUrl: "https://github.com/example/github-mismatch-project",
        },
      });

      await putWebhook(repoMismatchContext.sessionId, repoMismatchContext.project.id, "github", {
        enabled: true,
        secret: "github-mismatch-secret",
      });

      const mismatchBody = JSON.stringify({
        ref: "refs/heads/main",
        before: BEFORE_SHA,
        after: AFTER_SHA,
        repository: buildGitHubRepository(
          "https://github.com/example/another-project",
          repoMismatchContext.project.defaultBranch,
        ),
      });

      const repoMismatch = await postPublicWebhook("github", repoMismatchContext.project, mismatchBody, {
        "content-type": "application/json; charset=utf-8",
        "x-github-event": "push",
        "x-github-delivery": "github-repo-mismatch",
        "x-hub-signature-256": await signGitHubPayload("github-mismatch-secret", mismatchBody),
      });
      expect(repoMismatch.status).toBe(403);

      const missingHeaderContext = await createOwnedProjectContext({
        user: {
          email: "webhook-public-github-missing-header@example.com",
          slug: "webhook-public-github-missing-header",
        },
        project: {
          projectSlug: "github-missing-header-project",
          repoUrl: "https://github.com/example/github-missing-header-project",
        },
      });

      await putWebhook(missingHeaderContext.sessionId, missingHeaderContext.project.id, "github", {
        enabled: true,
        secret: "github-missing-header-secret",
      });

      const missingHeaderBody = JSON.stringify({
        ref: "refs/heads/main",
        before: BEFORE_SHA,
        after: AFTER_SHA,
        repository: buildGitHubRepository(
          missingHeaderContext.project.repoUrl,
          missingHeaderContext.project.defaultBranch,
        ),
      });

      const missingHeader = await postPublicWebhook("github", missingHeaderContext.project, missingHeaderBody, {
        "content-type": "application/json; charset=utf-8",
        "x-github-event": "push",
        "x-hub-signature-256": await signGitHubPayload("github-missing-header-secret", missingHeaderBody),
      });
      expect(missingHeader.status).toBe(401);

      const invalidTokenContext = await createOwnedProjectContext({
        user: {
          email: "webhook-public-gitlab-invalid-token@example.com",
          slug: "webhook-public-gitlab-invalid-token",
        },
        project: {
          projectSlug: "gitlab-invalid-token-project",
          repoUrl: "https://gitlab.com/example/gitlab-invalid-token-project",
        },
      });

      await putWebhook(invalidTokenContext.sessionId, invalidTokenContext.project.id, "gitlab", {
        enabled: true,
        config: null,
        secret: "gitlab-invalid-token-secret",
      });

      const invalidTokenBody = JSON.stringify({
        object_kind: "push",
        event_name: "push",
        ref: "refs/heads/main",
        before: BEFORE_SHA,
        after: AFTER_SHA,
        checkout_sha: AFTER_SHA,
        project: buildGitLabProjectPayload(
          invalidTokenContext.project.repoUrl,
          invalidTokenContext.project.defaultBranch,
        ),
        repository: buildGitLabRepositoryPayload(invalidTokenContext.project.repoUrl),
      });

      const invalidToken = await postPublicWebhook("gitlab", invalidTokenContext.project, invalidTokenBody, {
        "content-type": "application/json; charset=utf-8",
        "x-gitlab-event": "Push Hook",
        "x-gitlab-token": "gitlab-wrong-token",
        "idempotency-key": "gitlab-invalid-token",
      });
      expect(invalidToken.status).toBe(401);

      const invalidSignatureRows = await readProjectDoRows(invalidSignatureContext.project.id);
      expect(invalidSignatureRows.runs).toEqual([]);
      expect(invalidSignatureRows.webhookDeliveries).toEqual([]);

      const repoMismatchRows = await readProjectDoRows(repoMismatchContext.project.id);
      expect(repoMismatchRows.runs).toEqual([]);
      expect(repoMismatchRows.webhookDeliveries).toEqual([]);

      const missingHeaderRows = await readProjectDoRows(missingHeaderContext.project.id);
      expect(missingHeaderRows.runs).toEqual([]);
      expect(missingHeaderRows.webhookDeliveries).toEqual([]);

      const invalidTokenRows = await readProjectDoRows(invalidTokenContext.project.id);
      expect(invalidTokenRows.runs).toEqual([]);
      expect(invalidTokenRows.webhookDeliveries).toEqual([]);
    });

    it("rejects webhook delivery with an invalid HMAC signature", async () => {
      const context = await createOwnedProjectContext({
        user: {
          email: "webhook-public-invalid-hmac@example.com",
          slug: "webhook-public-invalid-hmac",
        },
        project: {
          projectSlug: "invalid-hmac-project",
          repoUrl: "https://github.com/example/invalid-hmac-project",
        },
      });

      await putWebhook(context.sessionId, context.project.id, "github", {
        enabled: true,
        secret: "correct-secret",
      });

      const body = JSON.stringify({
        ref: "refs/heads/main",
        before: BEFORE_SHA,
        after: AFTER_SHA,
        head_commit: {
          id: AFTER_SHA,
        },
        repository: buildGitHubRepository(context.project.repoUrl, context.project.defaultBranch),
      });

      const response = await postPublicWebhook("github", context.project, body, {
        "content-type": "application/json; charset=utf-8",
        "x-github-event": "push",
        "x-github-delivery": "invalid-hmac-delivery",
        "x-hub-signature-256": await signGitHubPayload("wrong-secret", body),
      });
      expect(response.status).toBe(401);

      const rows = await readProjectDoRows(context.project.id);
      expect(rows.runs).toEqual([]);
      expect(rows.webhookDeliveries).toEqual([]);
    });

    it("rejects webhook delivery with an invalid GitLab shared secret", async () => {
      const context = await createOwnedProjectContext({
        user: {
          email: "webhook-public-invalid-gitlab-token@example.com",
          slug: "webhook-public-invalid-gitlab-token",
        },
        project: {
          projectSlug: "invalid-gitlab-token-project",
          repoUrl: "https://gitlab.com/example/invalid-gitlab-token-project",
        },
      });

      await putWebhook(context.sessionId, context.project.id, "gitlab", {
        enabled: true,
        config: null,
        secret: "correct-gitlab-secret",
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

      const response = await postPublicWebhook("gitlab", context.project, body, {
        "content-type": "application/json; charset=utf-8",
        "x-gitlab-event": "Push Hook",
        "x-gitlab-token": "wrong-secret",
        "idempotency-key": "invalid-gitlab-token-delivery",
      });
      expect(response.status).toBe(401);

      const rows = await readProjectDoRows(context.project.id);
      expect(rows.runs).toEqual([]);
      expect(rows.webhookDeliveries).toEqual([]);
    });

    it("rejects webhook delivery with missing required signature header", async () => {
      const context = await createOwnedProjectContext({
        user: {
          email: "webhook-public-missing-sig@example.com",
          slug: "webhook-public-missing-sig",
        },
        project: {
          projectSlug: "missing-sig-project",
          repoUrl: "https://github.com/example/missing-sig-project",
        },
      });

      await putWebhook(context.sessionId, context.project.id, "github", {
        enabled: true,
        secret: "missing-sig-secret",
      });

      const body = JSON.stringify({
        ref: "refs/heads/main",
        before: BEFORE_SHA,
        after: AFTER_SHA,
        head_commit: {
          id: AFTER_SHA,
        },
        repository: buildGitHubRepository(context.project.repoUrl, context.project.defaultBranch),
      });

      const response = await postPublicWebhook("github", context.project, body, {
        "content-type": "application/json; charset=utf-8",
        "x-github-event": "push",
        "x-github-delivery": "missing-sig-delivery",
      });
      expect(response.status).toBe(401);
    });

    it("rejects webhook delivery with non-JSON content type", async () => {
      const context = await createOwnedProjectContext({
        user: {
          email: "webhook-public-non-json-ct@example.com",
          slug: "webhook-public-non-json-ct",
        },
        project: {
          projectSlug: "non-json-ct-project",
          repoUrl: "https://github.com/example/non-json-ct-project",
        },
      });

      await putWebhook(context.sessionId, context.project.id, "github", {
        enabled: true,
        secret: "content-type-secret",
      });

      const body = JSON.stringify({
        ref: "refs/heads/main",
        before: BEFORE_SHA,
        after: AFTER_SHA,
        head_commit: {
          id: AFTER_SHA,
        },
        repository: buildGitHubRepository(context.project.repoUrl, context.project.defaultBranch),
      });

      const response = await postPublicWebhook("github", context.project, body, {
        "content-type": "text/plain",
        "x-github-event": "push",
        "x-github-delivery": "non-json-ct-delivery",
        "x-hub-signature-256": await signGitHubPayload("content-type-secret", body),
      });
      expect(response.status).toBe(415);
    });

    it("rejects webhook delivery to a disabled webhook with 404", async () => {
      const context = await createOwnedProjectContext({
        user: {
          email: "webhook-public-disabled-reject@example.com",
          slug: "webhook-public-disabled-reject",
        },
        project: {
          projectSlug: "disabled-reject-project",
          repoUrl: "https://github.com/example/disabled-reject-project",
        },
      });

      await putWebhook(context.sessionId, context.project.id, "github", {
        enabled: true,
        secret: "disabled-secret",
      });

      await putWebhook(context.sessionId, context.project.id, "github", {
        enabled: false,
      });

      const body = JSON.stringify({
        ref: "refs/heads/main",
        before: BEFORE_SHA,
        after: AFTER_SHA,
        head_commit: {
          id: AFTER_SHA,
        },
        repository: buildGitHubRepository(context.project.repoUrl, context.project.defaultBranch),
      });

      const response = await postPublicWebhook("github", context.project, body, {
        "content-type": "application/json; charset=utf-8",
        "x-github-event": "push",
        "x-github-delivery": "disabled-reject-delivery",
        "x-hub-signature-256": await signGitHubPayload("disabled-secret", body),
      });
      expect(response.status).toBe(404);

      const rows = await readProjectDoRows(context.project.id);
      expect(rows.runs).toEqual([]);
      expect(rows.webhookDeliveries).toEqual([]);
    });

    it("rejects webhook delivery when payload repository does not match project", async () => {
      const context = await createOwnedProjectContext({
        user: {
          email: "webhook-public-repo-mismatch@example.com",
          slug: "webhook-public-repo-mismatch",
        },
        project: {
          projectSlug: "repo-mismatch-project",
          repoUrl: "https://github.com/example/correct-repo",
        },
      });

      await putWebhook(context.sessionId, context.project.id, "github", {
        enabled: true,
        secret: "mismatch-secret",
      });

      const body = JSON.stringify({
        ref: "refs/heads/main",
        before: BEFORE_SHA,
        after: AFTER_SHA,
        head_commit: {
          id: AFTER_SHA,
        },
        repository: buildGitHubRepository("https://github.com/example/wrong-repo", context.project.defaultBranch),
      });

      const response = await postPublicWebhook("github", context.project, body, {
        "content-type": "application/json; charset=utf-8",
        "x-github-event": "push",
        "x-github-delivery": "repo-mismatch-delivery",
        "x-hub-signature-256": await signGitHubPayload("mismatch-secret", body),
      });
      expect(response.status).toBe(403);

      const rows = await readProjectDoRows(context.project.id);
      expect(rows.runs).toEqual([]);
      expect(rows.webhookDeliveries).toEqual([]);
    });
  });
});
