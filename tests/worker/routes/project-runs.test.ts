import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_DISPATCH_MODE,
  DEFAULT_EXECUTION_RUNTIME,
  type GetMeResponse,
  type GetProjectsResponse,
  type LogStreamTicketResponse,
  type ProjectDetail,
  type ProjectResponse,
  type RunDetail,
  type TriggerRunAcceptedResponse,
} from "@/contracts";
import { createD1Db } from "@/worker/db/d1";
import * as d1Schema from "@/worker/db/d1/schema";

import { acceptManualRunWithoutAlarm } from "../../helpers/project-do";
import { authHeaders, fetchJson, loginViaRoute, seedUser } from "../../helpers/runtime";
import { registerWorkerRuntimeHooks } from "../../helpers/worker-hooks";

describe("worker routes", () => {
  registerWorkerRuntimeHooks();

  describe("project and run flows", () => {
    it("supports login, project creation, run trigger, cancel, and log ticket flows", async () => {
      const user = await seedUser({
        email: "routes@example.com",
        slug: "routes-user",
        password: "swordfish",
      });

      const login = await loginViaRoute(user);
      expect(login.status).toBe(200);
      expect(login.body).not.toBeNull();
      const sessionId = login.body!.sessionId;

      const me = await fetchJson<GetMeResponse>("/api/private/me", {
        headers: authHeaders(sessionId),
      });
      expect(me.status).toBe(200);
      expect(me.body?.user.id).toBe(user.id);
      expect(me.body?.inviteTtlSeconds).toBe(Number(env.INVITE_TTL_SECONDS));

      const createdProject = await fetchJson<ProjectResponse>("/api/private/projects", {
        method: "POST",
        headers: authHeaders(sessionId, {
          "content-type": "application/json; charset=utf-8",
        }),
        body: JSON.stringify({
          projectSlug: "api-tests",
          name: "API Tests",
          repoUrl: "https://github.com/example/api-tests",
          defaultBranch: "main",
          configPath: ".anvil.yml",
        }),
      });
      expect(createdProject.status).toBe(201);
      expect(createdProject.body).not.toBeNull();
      expect(createdProject.body?.project.dispatchMode).toBe(DEFAULT_DISPATCH_MODE);

      const projectId = createdProject.body!.project.id;

      const listProjects = await fetchJson<GetProjectsResponse>("/api/private/projects", {
        headers: authHeaders(sessionId),
      });
      expect(listProjects.status).toBe(200);
      expect(listProjects.body?.projects.map((project) => project.id)).toContain(projectId);

      const acceptedRun = await fetchJson<TriggerRunAcceptedResponse>(`/api/private/projects/${projectId}/runs`, {
        method: "POST",
        headers: authHeaders(sessionId, {
          "content-type": "application/json; charset=utf-8",
        }),
        body: JSON.stringify({}),
      });
      expect(acceptedRun.status).toBe(202);
      expect(acceptedRun.body).not.toBeNull();

      const runId = acceptedRun.body!.runId;

      const projectDetail = await fetchJson<ProjectDetail>(`/api/private/projects/${projectId}`, {
        headers: authHeaders(sessionId),
      });
      expect(projectDetail.status).toBe(200);
      expect(projectDetail.body?.project.dispatchMode).toBe(DEFAULT_DISPATCH_MODE);
      const visibleRunIds = [
        projectDetail.body?.activeRun?.id,
        ...(projectDetail.body?.pendingRuns.map((run) => run.runId) ?? []),
      ].filter((value) => value !== undefined);
      expect(visibleRunIds).toContain(runId);

      const runDetailBeforeCancel = await fetchJson<RunDetail>(`/api/private/runs/${runId}`, {
        headers: authHeaders(sessionId),
      });
      expect(runDetailBeforeCancel.status).toBe(200);
      expect(runDetailBeforeCancel.body?.run.status).not.toBe("pending");

      const canceledRun = await fetchJson<RunDetail>(`/api/private/runs/${runId}/cancel`, {
        method: "POST",
        headers: authHeaders(sessionId),
      });
      expect(canceledRun.status).toBe(200);
      expect(canceledRun.body?.run.status).toBe("cancel_requested");

      const logTicket = await fetchJson<LogStreamTicketResponse>(`/api/private/runs/${runId}/log-ticket`, {
        method: "POST",
        headers: authHeaders(sessionId),
      });
      expect(logTicket.status).toBe(200);
      expect(logTicket.body).not.toBeNull();
      expect(logTicket.body!.ticket).toMatch(/^[A-Za-z0-9_-]+$/u);
      expect(typeof logTicket.body!.expiresAt).toBe("string");

      const runDetailAfterCancel = await fetchJson<RunDetail>(`/api/private/runs/${runId}`, {
        headers: authHeaders(sessionId),
      });
      expect(runDetailAfterCancel.status).toBe(200);
      expect(["cancel_requested", "canceling", "canceled", "failed"]).toContain(runDetailAfterCancel.body?.run.status);

      const db = createD1Db(env.DB);
      await db
        .update(d1Schema.users)
        .set({
          disabledAt: Date.now(),
        })
        .where(eq(d1Schema.users.id, user.id));

      const disabledUpgrade = await fetchJson(`/api/private/runs/${runId}/logs?ticket=${logTicket.body!.ticket}`, {
        headers: {
          upgrade: "websocket",
        },
      });
      expect(disabledUpgrade.status).toBe(403);
      expect(disabledUpgrade.body).toMatchObject({
        error: {
          code: "user_disabled",
        },
      });
    });

    it("returns project_queue_full when a manual trigger exceeds the per-project queue cap", async () => {
      const user = await seedUser({
        email: "routes-queue-full@example.com",
        slug: "routes-queue-full",
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
          projectSlug: "queue-full-project",
          name: "Queue Full Project",
          repoUrl: "https://github.com/example/queue-full-project",
          defaultBranch: "main",
          configPath: ".anvil.yml",
        }),
      });
      expect(createdProject.status).toBe(201);
      expect(createdProject.body).not.toBeNull();

      const project = createdProject.body!.project;
      const projectStub = env.PROJECT_DO.getByName(project.id);

      for (let index = 0; index < 20; index += 1) {
        await acceptManualRunWithoutAlarm(projectStub, {
          projectId: project.id,
          triggeredByUserId: user.id,
          branch: project.defaultBranch,
        });
      }

      const overflow = await fetchJson(`/api/private/projects/${project.id}/runs`, {
        method: "POST",
        headers: authHeaders(sessionId, {
          "content-type": "application/json; charset=utf-8",
        }),
        body: JSON.stringify({}),
      });

      expect(overflow.status).toBe(409);
      expect(overflow.body).toMatchObject({
        error: {
          code: "project_queue_full",
        },
      });
    });

    it("accepts and returns explicit dispatch mode changes on create and update", async () => {
      const user = await seedUser({
        email: "routes-dispatch-mode@example.com",
        slug: "routes-dispatch-mode",
        password: "swordfish",
      });

      const login = await loginViaRoute(user);
      expect(login.status).toBe(200);
      const sessionId = login.body!.sessionId;

      const createdProject = await fetchJson<ProjectResponse>("/api/private/projects", {
        method: "POST",
        headers: authHeaders(sessionId, {
          "content-type": "application/json; charset=utf-8",
        }),
        body: JSON.stringify({
          projectSlug: "workflow-project",
          name: "Workflow Project",
          repoUrl: "https://github.com/example/workflow-project",
          defaultBranch: "main",
          configPath: ".anvil.yml",
          dispatchMode: "workflows",
        }),
      });
      expect(createdProject.status).toBe(201);
      expect(createdProject.body?.project.dispatchMode).toBe("workflows");

      const updatedProject = await fetchJson<ProjectResponse>(
        `/api/private/projects/${createdProject.body!.project.id}`,
        {
          method: "PATCH",
          headers: authHeaders(sessionId, {
            "content-type": "application/json; charset=utf-8",
          }),
          body: JSON.stringify({
            dispatchMode: "queue",
          }),
        },
      );
      expect(updatedProject.status).toBe(200);
      expect(updatedProject.body?.project.dispatchMode).toBe("queue");

      const detail = await fetchJson<ProjectDetail>(`/api/private/projects/${createdProject.body!.project.id}`, {
        headers: authHeaders(sessionId),
      });
      expect(detail.status).toBe(200);
      expect(detail.body?.project.dispatchMode).toBe("queue");
    });
  });
});
