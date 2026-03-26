import { env } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";

import { type ProjectDetail, type ProjectResponse, type TriggerRunAcceptedResponse } from "@/contracts";

import { authHeaders, fetchJson, loginViaRoute, seedUser } from "../../helpers/runtime";
import { registerWorkerRuntimeHooks } from "../../helpers/worker-hooks";

describe("worker routes", () => {
  registerWorkerRuntimeHooks();

  describe("visibility and atomicity", () => {
    it("does not persist webhook-relevant project updates when ProjectDO config mutation fails", async () => {
      const user = await seedUser({
        email: "routes-webhook-version-touch@example.com",
        slug: "routes-webhook-version-touch",
        password: "swordfish",
      });

      const login = await loginViaRoute(user);
      expect(login.status).toBe(200);
      expect(login.body).not.toBeNull();
      const sessionId = login.body!.sessionId;

      const createdProject = await fetchJson<ProjectResponse>("/api/private/projects", {
        method: "POST",
        headers: authHeaders(sessionId, {
          "content-type": "application/json; charset=utf-8",
        }),
        body: JSON.stringify({
          projectSlug: "version-touch-project",
          name: "Version Touch Project",
          repoUrl: "https://github.com/example/version-touch-project",
          defaultBranch: "main",
          configPath: ".anvil.yml",
          dispatchMode: "queue",
        }),
      });
      expect(createdProject.status).toBe(201);
      expect(createdProject.body).not.toBeNull();

      const project = createdProject.body!.project;
      const createdWebhook = await fetchJson(`/api/private/projects/${project.id}/webhooks/github`, {
        method: "PUT",
        headers: authHeaders(sessionId, {
          "content-type": "application/json; charset=utf-8",
        }),
        body: JSON.stringify({
          enabled: true,
          secret: "routes-version-touch-secret",
        }),
      });
      expect(createdWebhook.status).toBe(201);

      const originalGetByName = env.PROJECT_DO.getByName.bind(env.PROJECT_DO);
      const getByNameSpy = vi.spyOn(env.PROJECT_DO, "getByName").mockImplementation((name) => {
        if (name !== project.id) {
          return originalGetByName(name);
        }

        return {
          updateProjectConfig: async () => {
            throw new Error("update_project_config_failed");
          },
        } as unknown as ReturnType<typeof env.PROJECT_DO.getByName>;
      });

      try {
        const failedUpdate = await fetchJson(`/api/private/projects/${project.id}`, {
          method: "PATCH",
          headers: authHeaders(sessionId, {
            "content-type": "application/json; charset=utf-8",
          }),
          body: JSON.stringify({
            defaultBranch: "develop",
          }),
        });

        expect(failedUpdate.status).toBe(500);
        expect(failedUpdate.body).toMatchObject({
          error: {
            code: "internal_error",
          },
        });
      } finally {
        getByNameSpy.mockRestore();
      }

      const projectDetail = await fetchJson<ProjectDetail>(`/api/private/projects/${project.id}`, {
        headers: authHeaders(sessionId),
      });
      expect(projectDetail.status).toBe(200);
      expect(projectDetail.body?.project.defaultBranch).toBe("main");
    });

    it("masks project and run ownership checks as not found for other users", async () => {
      const owner = await seedUser({
        email: "routes-owner@example.com",
        slug: "routes-owner",
        password: "swordfish",
      });
      const otherUser = await seedUser({
        email: "routes-other@example.com",
        slug: "routes-other",
        password: "swordfish",
      });

      const ownerLogin = await loginViaRoute(owner);
      expect(ownerLogin.status).toBe(200);
      expect(ownerLogin.body).not.toBeNull();
      const ownerSessionId = ownerLogin.body!.sessionId;

      const otherLogin = await loginViaRoute(otherUser);
      expect(otherLogin.status).toBe(200);
      expect(otherLogin.body).not.toBeNull();
      const otherSessionId = otherLogin.body!.sessionId;

      const createdProject = await fetchJson<ProjectResponse>("/api/private/projects", {
        method: "POST",
        headers: authHeaders(ownerSessionId, {
          "content-type": "application/json; charset=utf-8",
        }),
        body: JSON.stringify({
          projectSlug: "owner-only-project",
          name: "Owner Only Project",
          repoUrl: "https://github.com/example/owner-only-project",
          defaultBranch: "main",
          configPath: ".anvil.yml",
          dispatchMode: "queue",
        }),
      });
      expect(createdProject.status).toBe(201);
      expect(createdProject.body).not.toBeNull();

      const projectId = createdProject.body!.project.id;

      const triggeredRun = await fetchJson<TriggerRunAcceptedResponse>(`/api/private/projects/${projectId}/runs`, {
        method: "POST",
        headers: authHeaders(ownerSessionId, {
          "content-type": "application/json; charset=utf-8",
        }),
        body: JSON.stringify({}),
      });
      expect(triggeredRun.status).toBe(202);
      expect(triggeredRun.body).not.toBeNull();

      const runId = triggeredRun.body!.runId;

      const projectDetail = await fetchJson(`/api/private/projects/${projectId}`, {
        headers: authHeaders(otherSessionId),
      });
      expect(projectDetail.status).toBe(404);
      expect(projectDetail.body).toMatchObject({
        error: {
          code: "project_not_found",
        },
      });

      const projectRuns = await fetchJson(`/api/private/projects/${projectId}/runs`, {
        headers: authHeaders(otherSessionId),
      });
      expect(projectRuns.status).toBe(404);
      expect(projectRuns.body).toMatchObject({
        error: {
          code: "project_not_found",
        },
      });

      const updatedProject = await fetchJson(`/api/private/projects/${projectId}`, {
        method: "PATCH",
        headers: authHeaders(otherSessionId, {
          "content-type": "application/json; charset=utf-8",
        }),
        body: JSON.stringify({
          name: "Renamed by intruder",
        }),
      });
      expect(updatedProject.status).toBe(404);
      expect(updatedProject.body).toMatchObject({
        error: {
          code: "project_not_found",
        },
      });

      const triggeredByOtherUser = await fetchJson(`/api/private/projects/${projectId}/runs`, {
        method: "POST",
        headers: authHeaders(otherSessionId, {
          "content-type": "application/json; charset=utf-8",
        }),
        body: JSON.stringify({}),
      });
      expect(triggeredByOtherUser.status).toBe(404);
      expect(triggeredByOtherUser.body).toMatchObject({
        error: {
          code: "project_not_found",
        },
      });

      const runDetail = await fetchJson(`/api/private/runs/${runId}`, {
        headers: authHeaders(otherSessionId),
      });
      expect(runDetail.status).toBe(404);
      expect(runDetail.body).toMatchObject({
        error: {
          code: "run_not_found",
        },
      });

      const canceledRun = await fetchJson(`/api/private/runs/${runId}/cancel`, {
        method: "POST",
        headers: authHeaders(otherSessionId),
      });
      expect(canceledRun.status).toBe(404);
      expect(canceledRun.body).toMatchObject({
        error: {
          code: "run_not_found",
        },
      });

      const logTicket = await fetchJson(`/api/private/runs/${runId}/log-ticket`, {
        method: "POST",
        headers: authHeaders(otherSessionId),
      });
      expect(logTicket.status).toBe(404);
      expect(logTicket.body).toMatchObject({
        error: {
          code: "run_not_found",
        },
      });
    });
  });
});
