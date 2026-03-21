import { describe, expect, it } from "vitest";

import { readProjectDoRows } from "../../../helpers/runtime";
import { registerWorkerRuntimeHooks } from "../../../helpers/worker-hooks";

import { createOwnedProjectContext, getProjectDetail, getWebhooks, putWebhook } from "../helpers";

describe("webhook private routes", () => {
  registerWorkerRuntimeHooks();

  describe("upsert behavior", () => {
    it("creates a configured provider with a generated secret and never echoes it from GET", async () => {
      const context = await createOwnedProjectContext({
        user: {
          email: "webhook-private-generated@example.com",
          slug: "webhook-private-generated",
        },
        project: {
          projectSlug: "generated-secret-project",
          repoUrl: "https://github.com/example/generated-secret-project",
        },
      });

      const created = await putWebhook(context.sessionId, context.project.id, "github", {
        enabled: true,
      });
      expect(created.status).toBe(201);
      expect(created.body).not.toBeNull();
      expect(created.body?.generatedSecret).toEqual(expect.any(String));
      expect(created.body?.webhook.provider).toBe("github");
      expect(created.body?.webhook.config).toBeNull();
      expect(created.body?.webhook.recentDeliveries).toEqual([]);

      const listed = await getWebhooks(context.sessionId, context.project.id);
      expect(listed.status).toBe(200);
      expect(listed.body?.webhooks).toHaveLength(1);
      expect(listed.body?.webhooks[0]?.provider).toBe("github");
      expect(listed.body?.webhooks[0]?.recentDeliveries).toEqual([]);
      expect(listed.text).not.toContain(created.body!.generatedSecret!);

      const rows = await readProjectDoRows(context.project.id);
      expect(rows.webhooks).toHaveLength(1);
      expect(rows.webhookDeliveries).toHaveLength(0);
      expect(rows.webhooks[0]?.provider).toBe("github");
      expect(rows.webhooks[0]?.enabled).toBe(1);
      expect(rows.webhooks[0]?.configJson).toBeNull();
    });

    it("rejects invalid provider config and secret replacement on update without mutating durable state", async () => {
      const githubContext = await createOwnedProjectContext({
        user: {
          email: "webhook-private-config@example.com",
          slug: "webhook-private-config",
        },
        project: {
          projectSlug: "config-project",
          repoUrl: "https://github.com/example/config-project",
        },
      });

      const created = await putWebhook(githubContext.sessionId, githubContext.project.id, "github", {
        enabled: true,
        secret: "user-supplied-secret",
      });
      expect(created.status).toBe(201);
      expect(created.body?.generatedSecret).toBeNull();
      const beforeRejectedSecretUpdate = await readProjectDoRows(githubContext.project.id);
      expect(beforeRejectedSecretUpdate.webhooks).toHaveLength(1);

      const replacedSecret = await putWebhook(githubContext.sessionId, githubContext.project.id, "github", {
        enabled: false,
        secret: "should-be-rejected",
      });
      expect(replacedSecret.status).toBe(400);
      const afterRejectedSecretUpdate = await readProjectDoRows(githubContext.project.id);
      expect(afterRejectedSecretUpdate.webhooks).toHaveLength(1);
      expect(afterRejectedSecretUpdate.webhooks[0]?.enabled).toBe(beforeRejectedSecretUpdate.webhooks[0]?.enabled);
      expect(afterRejectedSecretUpdate.webhooks[0]?.secretCiphertext).toEqual(
        beforeRejectedSecretUpdate.webhooks[0]?.secretCiphertext,
      );
      expect(afterRejectedSecretUpdate.webhooks[0]?.secretNonce).toEqual(
        beforeRejectedSecretUpdate.webhooks[0]?.secretNonce,
      );

      const githubConfig = await putWebhook(githubContext.sessionId, githubContext.project.id, "github", {
        enabled: true,
        config: {
          instanceUrl: "https://github.example.com",
        },
      });
      expect(githubConfig.status).toBe(400);

      const giteaContext = await createOwnedProjectContext({
        user: {
          email: "webhook-private-gitea@example.com",
          slug: "webhook-private-gitea",
        },
        project: {
          projectSlug: "gitea-config-project",
          repoUrl: "https://gitea.example.com:8443/git/example/gitea-config-project",
        },
      });

      const missingGiteaConfig = await putWebhook(giteaContext.sessionId, giteaContext.project.id, "gitea", {
        enabled: true,
        secret: "gitea-secret",
      });
      expect(missingGiteaConfig.status).toBe(400);

      const gitlabContext = await createOwnedProjectContext({
        user: {
          email: "webhook-private-gitlab@example.com",
          slug: "webhook-private-gitlab",
        },
        project: {
          projectSlug: "gitlab-config-project",
          repoUrl: "https://gitlab.com/example/gitlab-config-project",
        },
      });

      const defaultGitLab = await putWebhook(gitlabContext.sessionId, gitlabContext.project.id, "gitlab", {
        enabled: true,
        config: null,
        secret: "gitlab-secret",
      });
      expect(defaultGitLab.status).toBe(201);
      expect(defaultGitLab.body?.generatedSecret).toBeNull();
      expect(defaultGitLab.body?.webhook.config).toBeNull();
    });

    it("preserves existing provider config when update omits config", async () => {
      const context = await createOwnedProjectContext({
        user: {
          email: "webhook-private-preserve-config@example.com",
          slug: "webhook-private-preserve-config",
        },
        project: {
          projectSlug: "preserve-config-project",
          repoUrl: "https://gitea.example.com:8443/git/example/preserve-config-project",
        },
      });

      const created = await putWebhook(context.sessionId, context.project.id, "gitea", {
        enabled: true,
        config: {
          instanceUrl: "https://gitea.example.com:8443/git",
        },
        secret: "preserve-config-secret",
      });
      expect(created.status).toBe(201);
      expect(created.body?.webhook.config).toEqual({
        instanceUrl: "https://gitea.example.com:8443/git",
      });

      const updated = await putWebhook(context.sessionId, context.project.id, "gitea", {
        enabled: false,
      });
      expect(updated.status).toBe(200);
      expect(updated.body?.generatedSecret).toBeNull();
      expect(updated.body?.webhook.config).toEqual({
        instanceUrl: "https://gitea.example.com:8443/git",
      });
      expect(updated.body?.webhook.enabled).toBe(false);

      const listed = await getWebhooks(context.sessionId, context.project.id);
      expect(listed.status).toBe(200);
      expect(listed.body?.webhooks).toHaveLength(1);
      expect(listed.body?.webhooks[0]?.config).toEqual({
        instanceUrl: "https://gitea.example.com:8443/git",
      });
      expect(listed.body?.webhooks[0]?.enabled).toBe(false);

      const rows = await readProjectDoRows(context.project.id);
      expect(rows.webhooks).toHaveLength(1);
      expect(rows.webhooks[0]?.configJson).toBe(JSON.stringify({ instanceUrl: "https://gitea.example.com:8443/git" }));
      expect(rows.webhooks[0]?.enabled).toBe(0);
    });

    it("does not let concurrent create-like requests replace an existing secret", async () => {
      const context = await createOwnedProjectContext({
        user: {
          email: "webhook-private-concurrent@example.com",
          slug: "webhook-private-concurrent",
        },
        project: {
          projectSlug: "concurrent-secret-project",
          repoUrl: "https://github.com/example/concurrent-secret-project",
        },
      });

      const [firstAttempt, secondAttempt] = await Promise.all([
        putWebhook(context.sessionId, context.project.id, "github", {
          enabled: true,
          secret: "concurrent-secret-a",
        }),
        putWebhook(context.sessionId, context.project.id, "github", {
          enabled: true,
          secret: "concurrent-secret-b",
        }),
      ]);

      const successResponses = [firstAttempt, secondAttempt].filter((response) => response.status < 300);
      const failureResponses = [firstAttempt, secondAttempt].filter((response) => response.status >= 300);

      expect(successResponses).toHaveLength(1);
      expect(failureResponses).toHaveLength(1);
      expect([400, 409]).toContain(failureResponses[0]!.status);

      const rows = await readProjectDoRows(context.project.id);
      expect(rows.webhooks).toHaveLength(1);

      const listed = await getWebhooks(context.sessionId, context.project.id);
      expect(listed.status).toBe(200);
      expect(listed.body?.webhooks).toHaveLength(1);
      expect(listed.text).not.toContain("concurrent-secret-a");
      expect(listed.text).not.toContain("concurrent-secret-b");

      const detail = await getProjectDetail(context.sessionId, context.project.id);
      expect(detail.status).toBe(200);
    });
  });
});
