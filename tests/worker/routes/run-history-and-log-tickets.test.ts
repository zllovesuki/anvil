import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_DISPATCH_MODE,
  DEFAULT_EXECUTION_RUNTIME,
  type GetProjectRunsResponse,
  type LogStreamTicketResponse,
  type ProjectResponse,
  RunId,
  type RunDetail,
  type RunWsMessage,
  type TriggerRunAcceptedResponse,
} from "@/contracts";
import { createD1Db } from "@/worker/db/d1";
import * as d1Schema from "@/worker/db/d1/schema";
import { generateDurableEntityId } from "@/worker/services";

import { authHeaders, fetchJson, loginViaRoute, seedProject, seedUser } from "../../helpers/runtime";
import { registerWorkerRuntimeHooks } from "../../helpers/worker-hooks";

const createProjectViaRoute = async (sessionId: string, projectSlug: string) =>
  await fetchJson<ProjectResponse>("/api/private/projects", {
    method: "POST",
    headers: authHeaders(sessionId, {
      "content-type": "application/json; charset=utf-8",
    }),
    body: JSON.stringify({
      projectSlug,
      name: `Project ${projectSlug}`,
      repoUrl: `https://github.com/example/${projectSlug}`,
      defaultBranch: "main",
      configPath: ".anvil.yml",
    }),
  });

const triggerRunViaRoute = async (sessionId: string, projectId: string, branch?: string) =>
  await fetchJson<TriggerRunAcceptedResponse>(`/api/private/projects/${projectId}/runs`, {
    method: "POST",
    headers: authHeaders(sessionId, {
      "content-type": "application/json; charset=utf-8",
    }),
    body: JSON.stringify(branch === undefined ? {} : { branch }),
  });

const createLogTicketViaRoute = async (sessionId: string, runId: string) =>
  await fetchJson<LogStreamTicketResponse>(`/api/private/runs/${runId}/log-ticket`, {
    method: "POST",
    headers: authHeaders(sessionId),
  });

const openLogStream = async (runId: string, ticket: string): Promise<Response> =>
  await exports.default.fetch(
    `https://example.com/api/private/runs/${runId}/logs?ticket=${encodeURIComponent(ticket)}`,
    {
      headers: {
        upgrade: "websocket",
      },
    },
  );

describe("worker run history and log ticket routes", () => {
  registerWorkerRuntimeHooks();

  it("uses the default branch for omitted manual runs and preserves explicit branch overrides", async () => {
    const user = await seedUser({
      email: "run-branches@example.com",
      slug: "run-branches-user",
      password: "swordfish",
    });

    const login = await loginViaRoute(user);
    expect(login.status).toBe(200);
    expect(login.body).not.toBeNull();
    const sessionId = login.body!.sessionId;

    const createdProject = await createProjectViaRoute(sessionId, "run-branches-project");
    expect(createdProject.status).toBe(201);
    expect(createdProject.body).not.toBeNull();
    const projectId = createdProject.body!.project.id;

    const defaultBranchRun = await triggerRunViaRoute(sessionId, projectId);
    expect(defaultBranchRun.status).toBe(202);
    expect(defaultBranchRun.body).not.toBeNull();

    const overrideBranchRun = await triggerRunViaRoute(sessionId, projectId, "release");
    expect(overrideBranchRun.status).toBe(202);
    expect(overrideBranchRun.body).not.toBeNull();

    const defaultRunDetail = await fetchJson<RunDetail>(`/api/private/runs/${defaultBranchRun.body!.runId}`, {
      headers: authHeaders(sessionId),
    });
    expect(defaultRunDetail.status).toBe(200);
    expect(defaultRunDetail.body?.run.branch).toBe("main");

    const overrideRunDetail = await fetchJson<RunDetail>(`/api/private/runs/${overrideBranchRun.body!.runId}`, {
      headers: authHeaders(sessionId),
    });
    expect(overrideRunDetail.status).toBe(200);
    expect(overrideRunDetail.body?.run.branch).toBe("release");
  });

  it("paginates project runs and validates limit and cursor query params", async () => {
    const user = await seedUser({
      email: "run-pagination@example.com",
      slug: "run-pagination-user",
      password: "swordfish",
    });

    const login = await loginViaRoute(user);
    expect(login.status).toBe(200);
    expect(login.body).not.toBeNull();
    const sessionId = login.body!.sessionId;

    const createdProject = await createProjectViaRoute(sessionId, "run-pagination-project");
    expect(createdProject.status).toBe(201);
    expect(createdProject.body).not.toBeNull();
    const project = createdProject.body!.project;

    const db = createD1Db(env.DB);
    const queuedAtValues = [Date.now() - 2_000, Date.now() - 1_000, Date.now()];
    const insertedRunIds = queuedAtValues.map((queuedAt, index) => generateDurableEntityId("run", queuedAt + index));

    await db.insert(d1Schema.runIndex).values(
      queuedAtValues.map((queuedAt, index) => ({
        id: insertedRunIds[index],
        projectId: project.id,
        triggeredByUserId: user.id,
        triggerType: "manual",
        branch: "main",
        commitSha: null,
        status: "passed",
        dispatchMode: DEFAULT_DISPATCH_MODE,
        executionRuntime: DEFAULT_EXECUTION_RUNTIME,
        queuedAt,
        startedAt: queuedAt + 10,
        finishedAt: queuedAt + 20,
        exitCode: 0,
      })),
    );

    const firstPage = await fetchJson<GetProjectRunsResponse>(`/api/private/projects/${project.id}/runs?limit=2`, {
      headers: authHeaders(sessionId),
    });
    expect(firstPage.status).toBe(200);
    expect(firstPage.body).not.toBeNull();
    expect(firstPage.body!.runs.map((run) => run.id)).toEqual([insertedRunIds[2], insertedRunIds[1]]);
    expect(firstPage.body!.nextCursor).toEqual(expect.any(String));

    const secondPage = await fetchJson<GetProjectRunsResponse>(
      `/api/private/projects/${project.id}/runs?limit=2&cursor=${encodeURIComponent(firstPage.body!.nextCursor!)}`,
      {
        headers: authHeaders(sessionId),
      },
    );
    expect(secondPage.status).toBe(200);
    expect(secondPage.body).not.toBeNull();
    expect(secondPage.body!.runs.map((run) => run.id)).toEqual([insertedRunIds[0]]);
    expect(secondPage.body!.nextCursor).toBeNull();

    const invalidLimit = await fetchJson(`/api/private/projects/${project.id}/runs?limit=0`, {
      headers: authHeaders(sessionId),
    });
    expect(invalidLimit.status).toBe(400);
    expect(invalidLimit.body).toMatchObject({
      error: {
        code: "invalid_request",
      },
    });

    const invalidCursor = await fetchJson(`/api/private/projects/${project.id}/runs?cursor=not-a-valid-cursor`, {
      headers: authHeaders(sessionId),
    });
    expect(invalidCursor.status).toBe(400);
    expect(invalidCursor.body).toMatchObject({
      error: {
        code: "invalid_cursor",
      },
    });
  });

  it("requires a websocket upgrade for log streams without consuming the ticket", async () => {
    const user = await seedUser({
      email: "run-log-upgrade@example.com",
      slug: "run-log-upgrade-user",
      password: "swordfish",
    });

    const login = await loginViaRoute(user);
    expect(login.status).toBe(200);
    expect(login.body).not.toBeNull();
    const sessionId = login.body!.sessionId;

    const createdProject = await createProjectViaRoute(sessionId, "run-log-upgrade-project");
    expect(createdProject.status).toBe(201);
    expect(createdProject.body).not.toBeNull();
    const projectId = createdProject.body!.project.id;

    const acceptedRun = await triggerRunViaRoute(sessionId, projectId);
    expect(acceptedRun.status).toBe(202);
    expect(acceptedRun.body).not.toBeNull();
    const runId = acceptedRun.body!.runId;

    const logTicket = await createLogTicketViaRoute(sessionId, runId);
    expect(logTicket.status).toBe(200);
    expect(logTicket.body).not.toBeNull();

    const upgradeRequired = await fetchJson(`/api/private/runs/${runId}/logs?ticket=${logTicket.body!.ticket}`);
    expect(upgradeRequired.status).toBe(426);
    expect(upgradeRequired.body).toMatchObject({
      error: {
        code: "upgrade_required",
      },
    });

    const websocketResponse = await openLogStream(runId, logTicket.body!.ticket);
    expect(websocketResponse.status).toBe(101);
  });

  it("rejects missing, mismatched, reused, and expired log tickets", async () => {
    const user = await seedUser({
      email: "run-log-ticket-errors@example.com",
      slug: "run-log-ticket-errors-user",
      password: "swordfish",
    });

    const login = await loginViaRoute(user);
    expect(login.status).toBe(200);
    expect(login.body).not.toBeNull();
    const sessionId = login.body!.sessionId;

    const createdProject = await createProjectViaRoute(sessionId, "run-log-ticket-errors-project");
    expect(createdProject.status).toBe(201);
    expect(createdProject.body).not.toBeNull();
    const projectId = createdProject.body!.project.id;

    const firstRun = await triggerRunViaRoute(sessionId, projectId);
    expect(firstRun.status).toBe(202);
    expect(firstRun.body).not.toBeNull();

    const secondRun = await triggerRunViaRoute(sessionId, projectId, "release");
    expect(secondRun.status).toBe(202);
    expect(secondRun.body).not.toBeNull();

    const missingTicket = await fetchJson(`/api/private/runs/${firstRun.body!.runId}/logs?ticket=missing-ticket`, {
      headers: {
        upgrade: "websocket",
      },
    });
    expect(missingTicket.status).toBe(403);
    expect(missingTicket.body).toMatchObject({
      error: {
        code: "invalid_log_ticket",
      },
    });

    const mismatchedTicket = await createLogTicketViaRoute(sessionId, firstRun.body!.runId);
    expect(mismatchedTicket.status).toBe(200);
    expect(mismatchedTicket.body).not.toBeNull();

    const mismatchedRun = await fetchJson(
      `/api/private/runs/${secondRun.body!.runId}/logs?ticket=${mismatchedTicket.body!.ticket}`,
      {
        headers: {
          upgrade: "websocket",
        },
      },
    );
    expect(mismatchedRun.status).toBe(403);
    expect(mismatchedRun.body).toMatchObject({
      error: {
        code: "invalid_log_ticket",
      },
    });

    const reusableTicket = await createLogTicketViaRoute(sessionId, firstRun.body!.runId);
    expect(reusableTicket.status).toBe(200);
    expect(reusableTicket.body).not.toBeNull();

    const firstOpen = await openLogStream(firstRun.body!.runId, reusableTicket.body!.ticket);
    expect(firstOpen.status).toBe(101);

    const reusedTicket = await fetchJson(
      `/api/private/runs/${firstRun.body!.runId}/logs?ticket=${reusableTicket.body!.ticket}`,
      {
        headers: {
          upgrade: "websocket",
        },
      },
    );
    expect(reusedTicket.status).toBe(403);
    expect(reusedTicket.body).toMatchObject({
      error: {
        code: "invalid_log_ticket",
      },
    });

    const expiredTicket = await createLogTicketViaRoute(sessionId, firstRun.body!.runId);
    expect(expiredTicket.status).toBe(200);
    expect(expiredTicket.body).not.toBeNull();

    await env.LOG_TICKETS.put(
      `run-log-ticket:${expiredTicket.body!.ticket}`,
      JSON.stringify({
        runId: firstRun.body!.runId,
        userId: user.id,
        expiresAt: Date.now() - 1_000,
      }),
      { expirationTtl: 60 },
    );

    const expired = await fetchJson(
      `/api/private/runs/${firstRun.body!.runId}/logs?ticket=${expiredTicket.body!.ticket}`,
      {
        headers: {
          upgrade: "websocket",
        },
      },
    );
    expect(expired.status).toBe(403);
    expect(expired.body).toMatchObject({
      error: {
        code: "invalid_log_ticket",
      },
    });
  });

  it("sends state snapshot in envelope format on websocket connect", async () => {
    const user = await seedUser({
      email: "ws-envelope@example.com",
      slug: "ws-envelope-user",
      password: "swordfish",
    });
    const project = await seedProject(user, {
      projectSlug: "ws-envelope-project",
    });

    const login = await loginViaRoute(user);
    expect(login.status).toBe(200);
    const sessionId = login.body!.sessionId;

    const runId = RunId.assertDecode(generateDurableEntityId("run", Date.now()));
    const runStub = env.RUN_DO.getByName(runId);
    await runStub.ensureInitialized({
      runId,
      projectId: project.id,
      triggerType: "manual",
      branch: project.defaultBranch,
      commitSha: null,
    });

    const logTicket = await createLogTicketViaRoute(sessionId, runId);
    expect(logTicket.status).toBe(200);

    // Need a D1 run-index row so the route can resolve run ownership
    const db = createD1Db(env.DB);
    await db.insert(d1Schema.runIndex).values({
      id: runId,
      projectId: project.id,
      triggeredByUserId: user.id,
      triggerType: "manual",
      branch: "main",
      commitSha: null,
      status: "queued",
      dispatchMode: DEFAULT_DISPATCH_MODE,
      executionRuntime: DEFAULT_EXECUTION_RUNTIME,
      queuedAt: Date.now(),
      startedAt: null,
      finishedAt: null,
      exitCode: null,
    });

    const wsResponse = await openLogStream(runId, logTicket.body!.ticket);
    expect(wsResponse.status).toBe(101);

    const ws = wsResponse.webSocket!;
    ws.accept();

    const messages: RunWsMessage[] = [];
    const closed = new Promise<void>((resolve) => {
      ws.addEventListener("message", (event) => {
        messages.push(JSON.parse(event.data as string) as RunWsMessage);
      });
      ws.addEventListener("close", () => resolve());
    });

    ws.close(1000, "done");
    await closed;

    // Should receive at least an initial state snapshot
    const stateMessages = messages.filter((m) => m.type === "state");
    expect(stateMessages.length).toBeGreaterThanOrEqual(1);

    const initial = stateMessages[0];
    expect(initial.type).toBe("state");
    if (initial.type !== "state") throw new Error("unreachable");

    expect(initial.run.status).toBe("queued");
    expect(initial.run.currentStep).toBeNull();
    expect(initial.run.startedAt).toBeNull();
    expect(initial.run.finishedAt).toBeNull();
    expect(initial.run.exitCode).toBeNull();
    expect(initial.run.errorMessage).toBeNull();
    expect(initial.steps).toEqual([]);

    // No log messages expected for a freshly initialized run
    const logMessages = messages.filter((m) => m.type === "log");
    expect(logMessages).toEqual([]);
  });
});
