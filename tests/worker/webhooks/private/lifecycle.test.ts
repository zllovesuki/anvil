import { describe, expect, it } from "vitest";

import { readProjectDoRows } from "../../../helpers/runtime";
import { registerWorkerRuntimeHooks } from "../../../helpers/worker-hooks";

import { createOwnedProjectContext, deleteWebhook, getWebhooks, putWebhook, rotateWebhookSecret } from "../helpers";

describe("webhook private routes", () => {
  registerWorkerRuntimeHooks();

  describe("provider lifecycle", () => {
    it("rotates webhook secrets and deletes provider config", async () => {
      const context = await createOwnedProjectContext({
        user: {
          email: "webhook-private-rotate@example.com",
          slug: "webhook-private-rotate",
        },
        project: {
          projectSlug: "rotate-project",
          repoUrl: "https://gitea.example.com:8443/git/example/rotate-project",
        },
      });

      const created = await putWebhook(context.sessionId, context.project.id, "gitea", {
        enabled: true,
        config: {
          instanceUrl: "https://gitea.example.com:8443/git",
        },
        secret: "initial-gitea-secret",
      });
      expect(created.status).toBe(201);

      const beforeRotate = await readProjectDoRows(context.project.id);
      expect(beforeRotate.webhooks).toHaveLength(1);

      const rotated = await rotateWebhookSecret(context.sessionId, context.project.id, "gitea");
      expect(rotated.status).toBe(200);
      expect(rotated.body?.secret).toEqual(expect.any(String));
      expect(rotated.body?.secret).not.toBe("initial-gitea-secret");

      const afterRotate = await readProjectDoRows(context.project.id);
      expect(afterRotate.webhooks).toHaveLength(1);
      expect(afterRotate.webhooks[0]?.secretCiphertext).not.toEqual(beforeRotate.webhooks[0]?.secretCiphertext);
      expect(afterRotate.webhooks[0]?.secretNonce).not.toEqual(beforeRotate.webhooks[0]?.secretNonce);

      const deleted = await deleteWebhook(context.sessionId, context.project.id, "gitea");
      expect(deleted.status).toBe(204);

      const listed = await getWebhooks(context.sessionId, context.project.id);
      expect(listed.status).toBe(200);
      expect(listed.body?.webhooks).toEqual([]);

      const afterDelete = await readProjectDoRows(context.project.id);
      expect(afterDelete.webhooks).toEqual([]);
    });

    it("manages multiple providers on the same project independently", async () => {
      const context = await createOwnedProjectContext({
        user: {
          email: "webhook-private-multi-provider@example.com",
          slug: "webhook-private-multi-provider",
        },
        project: {
          projectSlug: "multi-provider-project",
          repoUrl: "https://gitlab.example.com/example/multi-provider-project",
        },
      });

      const gitlabCreated = await putWebhook(context.sessionId, context.project.id, "gitlab", {
        enabled: true,
        config: { instanceUrl: "https://gitlab.example.com" },
        secret: "gitlab-multi-secret",
      });
      expect(gitlabCreated.status).toBe(201);

      const giteaCreated = await putWebhook(context.sessionId, context.project.id, "gitea", {
        enabled: true,
        config: { instanceUrl: "https://gitlab.example.com" },
        secret: "gitea-multi-secret",
      });
      expect(giteaCreated.status).toBe(201);

      const listed = await getWebhooks(context.sessionId, context.project.id);
      expect(listed.status).toBe(200);
      expect(listed.body?.webhooks).toHaveLength(2);
      const providers = listed.body!.webhooks.map((w) => w.provider).sort();
      expect(providers).toEqual(["gitea", "gitlab"]);

      await deleteWebhook(context.sessionId, context.project.id, "gitlab");
      const afterDelete = await getWebhooks(context.sessionId, context.project.id);
      expect(afterDelete.status).toBe(200);
      expect(afterDelete.body?.webhooks).toHaveLength(1);
      expect(afterDelete.body?.webhooks[0]?.provider).toBe("gitea");

      const rows = await readProjectDoRows(context.project.id);
      expect(rows.webhooks).toHaveLength(1);
      expect(rows.webhooks[0]?.provider).toBe("gitea");
    });
  });
});
