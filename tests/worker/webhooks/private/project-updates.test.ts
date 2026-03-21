import { env } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";

import { BranchName } from "@/contracts";
import { readProjectDoRows } from "../../../helpers/runtime";
import { registerWorkerRuntimeHooks } from "../../../helpers/worker-hooks";

import { createOwnedProjectContext, getProjectDetail, getWebhooks, patchProject, putWebhook } from "../helpers";

describe("webhook private routes", () => {
  registerWorkerRuntimeHooks();

  describe("project updates with configured webhooks", () => {
    it("rejects repoUrl updates that conflict with configured webhook providers", async () => {
      const context = await createOwnedProjectContext({
        user: {
          email: "webhook-private-repo-conflict@example.com",
          slug: "webhook-private-repo-conflict",
        },
        project: {
          projectSlug: "repo-conflict-project",
          repoUrl: "https://gitea.example.com:8443/git/example/repo-conflict-project",
        },
      });

      await putWebhook(context.sessionId, context.project.id, "gitea", {
        enabled: true,
        config: {
          instanceUrl: "https://gitea.example.com:8443/git",
        },
        secret: "repo-conflict-secret",
      });

      const updated = await patchProject(context.sessionId, context.project.id, {
        repoUrl: "https://github.com/example/repo-conflict-project",
      });
      expect(updated.status).toBe(400);
      expect(updated.text).toContain("project_repo_url_conflicts_with_webhook");
      expect(updated.text).toContain("gitea");

      const detail = await getProjectDetail(context.sessionId, context.project.id);
      expect(detail.status).toBe(200);
      expect(detail.body?.project.repoUrl).toBe(context.project.repoUrl);

      const listed = await getWebhooks(context.sessionId, context.project.id);
      expect(listed.status).toBe(200);
      expect(listed.body?.webhooks).toHaveLength(1);
      expect(listed.body?.webhooks[0]?.config).toEqual({
        instanceUrl: "https://gitea.example.com:8443/git",
      });
    });

    it("allows repoUrl updates that stay within the configured webhook instance", async () => {
      const context = await createOwnedProjectContext({
        user: {
          email: "webhook-private-repo-allowed@example.com",
          slug: "webhook-private-repo-allowed",
        },
        project: {
          projectSlug: "repo-allowed-project",
          repoUrl: "https://gitlab.example.com/example/repo-allowed-project",
        },
      });

      await putWebhook(context.sessionId, context.project.id, "gitlab", {
        enabled: true,
        config: {
          instanceUrl: "https://gitlab.example.com",
        },
        secret: "repo-allowed-secret",
      });

      const updated = await patchProject(context.sessionId, context.project.id, {
        repoUrl: "https://gitlab.example.com/example/repo-allowed-project-renamed",
      });
      expect(updated.status).toBe(200);
      expect(updated.body?.project.repoUrl).toBe("https://gitlab.example.com/example/repo-allowed-project-renamed");

      const listed = await getWebhooks(context.sessionId, context.project.id);
      expect(listed.status).toBe(200);
      expect(listed.body?.webhooks).toHaveLength(1);
      expect(listed.body?.webhooks[0]?.config).toEqual({
        instanceUrl: "https://gitlab.example.com",
      });
    });

    it("does not bump configured webhook versions for name-only or repoToken-only updates", async () => {
      const context = await createOwnedProjectContext({
        user: {
          email: "webhook-private-non-material-update@example.com",
          slug: "webhook-private-non-material-update",
        },
        project: {
          projectSlug: "non-material-update-project",
          repoUrl: "https://gitlab.example.com/example/non-material-update-project",
        },
      });

      await putWebhook(context.sessionId, context.project.id, "gitlab", {
        enabled: true,
        config: {
          instanceUrl: "https://gitlab.example.com",
        },
        secret: "non-material-update-secret",
      });

      const before = await readProjectDoRows(context.project.id);
      expect(before.webhooks).toHaveLength(1);

      const renamed = await patchProject(context.sessionId, context.project.id, {
        name: "Renamed Project",
      });
      expect(renamed.status).toBe(200);
      expect(renamed.body?.project.name).toBe("Renamed Project");

      const afterRename = await readProjectDoRows(context.project.id);
      expect(afterRename.webhooks).toHaveLength(1);
      expect(afterRename.webhooks[0]?.updatedAt).toBe(before.webhooks[0]?.updatedAt);
      expect(afterRename.webhooks[0]?.configJson).toBe(before.webhooks[0]?.configJson);
      expect(afterRename.webhooks[0]?.secretCiphertext).toEqual(before.webhooks[0]?.secretCiphertext);
      expect(afterRename.webhooks[0]?.secretNonce).toEqual(before.webhooks[0]?.secretNonce);

      const retokened = await patchProject(context.sessionId, context.project.id, {
        repoToken: "updated-repo-token",
      });
      expect(retokened.status).toBe(200);

      const afterRepoToken = await readProjectDoRows(context.project.id);
      expect(afterRepoToken.webhooks).toHaveLength(1);
      expect(afterRepoToken.webhooks[0]?.updatedAt).toBe(before.webhooks[0]?.updatedAt);
      expect(afterRepoToken.webhooks[0]?.configJson).toBe(before.webhooks[0]?.configJson);
      expect(afterRepoToken.webhooks[0]?.secretCiphertext).toEqual(before.webhooks[0]?.secretCiphertext);
      expect(afterRepoToken.webhooks[0]?.secretNonce).toEqual(before.webhooks[0]?.secretNonce);

      const detail = await getProjectDetail(context.sessionId, context.project.id);
      expect(detail.status).toBe(200);
      expect(detail.body?.project.name).toBe("Renamed Project");
    });

    it("bumps configured webhook versions when project metadata changes", async () => {
      const context = await createOwnedProjectContext({
        user: {
          email: "webhook-private-version-bump@example.com",
          slug: "webhook-private-version-bump",
        },
        project: {
          projectSlug: "version-bump-project",
          repoUrl: "https://gitlab.example.com/example/version-bump-project",
        },
      });

      await putWebhook(context.sessionId, context.project.id, "gitlab", {
        enabled: true,
        config: {
          instanceUrl: "https://gitlab.example.com",
        },
        secret: "version-bump-secret",
      });

      const before = await readProjectDoRows(context.project.id);
      expect(before.webhooks).toHaveLength(1);

      const updated = await patchProject(context.sessionId, context.project.id, {
        repoUrl: "https://gitlab.example.com/example/version-bump-project-renamed",
        defaultBranch: BranchName.assertDecode("develop"),
        configPath: ".anvil.changed.yml",
      });
      expect(updated.status).toBe(200);

      const after = await readProjectDoRows(context.project.id);
      expect(after.webhooks).toHaveLength(1);
      expect(after.webhooks[0]?.updatedAt).toBeGreaterThan(before.webhooks[0]!.updatedAt);
      expect(after.webhooks[0]?.configJson).toBe(before.webhooks[0]?.configJson);
      expect(after.webhooks[0]?.secretCiphertext).toEqual(before.webhooks[0]?.secretCiphertext);
      expect(after.webhooks[0]?.secretNonce).toEqual(before.webhooks[0]?.secretNonce);

      const listed = await getWebhooks(context.sessionId, context.project.id);
      expect(listed.status).toBe(200);
      expect(listed.body?.webhooks).toHaveLength(1);
      expect(listed.body?.webhooks[0]?.config).toEqual({
        instanceUrl: "https://gitlab.example.com",
      });
    });

    it("does not persist webhook-relevant project updates when ProjectDO config mutation fails", async () => {
      const context = await createOwnedProjectContext({
        user: {
          email: "webhook-private-touch-failure@example.com",
          slug: "webhook-private-touch-failure",
        },
        project: {
          projectSlug: "touch-failure-project",
          repoUrl: "https://gitlab.example.com/example/touch-failure-project",
        },
      });

      await putWebhook(context.sessionId, context.project.id, "gitlab", {
        enabled: true,
        config: {
          instanceUrl: "https://gitlab.example.com",
        },
        secret: "touch-failure-secret",
      });

      const before = await readProjectDoRows(context.project.id);
      const originalGetByName = env.PROJECT_DO.getByName.bind(env.PROJECT_DO);
      const getProjectStubSpy = vi.spyOn(env.PROJECT_DO, "getByName").mockImplementation((name) => {
        if (name !== context.project.id) {
          return originalGetByName(name);
        }

        return {
          updateProjectConfig: async () => {
            throw new Error("update_project_config_failed");
          },
        } as unknown as ReturnType<typeof env.PROJECT_DO.getByName>;
      });

      let failedUpdate: Awaited<ReturnType<typeof patchProject>> | null = null;
      try {
        failedUpdate = await patchProject(context.sessionId, context.project.id, {
          defaultBranch: BranchName.assertDecode("develop"),
        });
      } finally {
        getProjectStubSpy.mockRestore();
      }

      expect(failedUpdate?.status).toBe(500);

      const detail = await getProjectDetail(context.sessionId, context.project.id);
      expect(detail.status).toBe(200);
      expect(detail.body?.project.defaultBranch).toBe(context.project.defaultBranch);

      const after = await readProjectDoRows(context.project.id);
      expect(after.webhooks).toHaveLength(1);
      expect(after.webhooks[0]?.updatedAt).toBe(before.webhooks[0]?.updatedAt);
      expect(after.webhooks[0]?.configJson).toBe(before.webhooks[0]?.configJson);
      expect(after.webhooks[0]?.secretCiphertext).toEqual(before.webhooks[0]?.secretCiphertext);
      expect(after.webhooks[0]?.secretNonce).toEqual(before.webhooks[0]?.secretNonce);
    });
  });
});
