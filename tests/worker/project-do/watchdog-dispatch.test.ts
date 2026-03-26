import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import { DEFAULT_DISPATCH_MODE, DEFAULT_EXECUTION_RUNTIME } from "@/contracts";
import { DISPATCH_RETRY_DELAYS_MS, HEARTBEAT_STALE_AFTER_MS } from "@/worker/durable/project-do/constants";
import { createD1Db } from "@/worker/db/d1";
import * as d1Schema from "@/worker/db/d1/schema";
import { ProjectDO } from "@/worker/durable";
import {
  dispatchExecutableRun,
  reconcileAcceptedRunD1Sync,
  reconcileActiveRunWatchdog,
  reconcileTerminalRunD1Sync,
} from "@/worker/durable/project-do/reconciliation";
import { recoverWorkflowDispatchFailure } from "@/worker/durable/project-do/commands";
import { getDispatchRetryAt, getSandboxCleanupRetryState } from "@/worker/durable/project-do/sidecar-state";
import type { ProjectDoContext } from "@/worker/durable/project-do/types";

import {
  acceptManualRunWithoutAlarm,
  createTestProjectDoContext,
  expectAcceptedManualRun,
} from "../../helpers/project-do";
import { registerWorkerRuntimeHooks } from "../../helpers/worker-hooks";
import { readProjectDoRows, seedProject, seedUser } from "../../helpers/runtime";

describe("ProjectDO watchdog and dispatch recovery", () => {
  registerWorkerRuntimeHooks();

  it("fails stale active runs as runner_lost during watchdog recovery", async () => {
    const baseTime = 1_710_000_000_000;
    const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => baseTime);

    try {
      const user = await seedUser({
        email: "watchdog@example.com",
        slug: "watchdog-user",
      });
      const project = await seedProject(user, {
        projectSlug: "watchdog-project",
      });
      const projectStub = env.PROJECT_DO.getByName(project.id);

      const accepted = expectAcceptedManualRun(
        await projectStub.acceptManualRun({
          projectId: project.id,
          triggeredByUserId: user.id,
          branch: project.defaultBranch,
        }),
      );

      const claim = await projectStub.claimRunWork({
        projectId: project.id,
        runId: accepted.runId,
      });
      expect(claim.kind).toBe("execute");

      nowSpy.mockImplementation(() => baseTime + HEARTBEAT_STALE_AFTER_MS + 1);
      await runInDurableObject(env.PROJECT_DO.getByName(project.id), async (instance: ProjectDO) => {
        await instance.alarm();
      });

      const rows = await readProjectDoRows(project.id);
      expect(rows.state?.activeRunId).toBeNull();
      expect(rows.runs[0]?.status).toBe("failed");
      expect(rows.runs[0]?.lastError).toBe("runner_lost");

      const runMeta = await env.RUN_DO.getByName(accepted.runId).getRunSummary(accepted.runId);
      expect(runMeta?.status).toBe("failed");
      expect(runMeta?.errorMessage).toBe("runner_lost");
      expect(runMeta?.startedAt).toBeNull();

      const db = createD1Db(env.DB);
      const d1Row = await db.select().from(d1Schema.runIndex).where(eq(d1Schema.runIndex.id, accepted.runId)).limit(1);
      expect(d1Row[0]?.status).toBe("failed");
      expect(d1Row[0]?.startedAt).toBeNull();
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("persists sandbox cleanup retry state when watchdog cleanup fails", async () => {
    const baseTime = 1_715_000_000_000;
    const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => baseTime);

    try {
      const user = await seedUser({
        email: "watchdog-cleanup@example.com",
        slug: "watchdog-cleanup-user",
      });
      const project = await seedProject(user, {
        projectSlug: "watchdog-cleanup-project",
      });
      const projectStub = env.PROJECT_DO.getByName(project.id);

      const accepted = expectAcceptedManualRun(
        await projectStub.acceptManualRun({
          projectId: project.id,
          triggeredByUserId: user.id,
          branch: project.defaultBranch,
        }),
      );

      const claim = await projectStub.claimRunWork({
        projectId: project.id,
        runId: accepted.runId,
      });
      expect(claim.kind).toBe("execute");

      nowSpy.mockImplementation(() => baseTime + HEARTBEAT_STALE_AFTER_MS + 1);
      await runInDurableObject(projectStub, async (instance: ProjectDO) => {
        const baseContext = createTestProjectDoContext(instance);
        const context: ProjectDoContext = {
          ...baseContext,
          env: Object.assign(Object.create(baseContext.env), {
            Sandbox: Object.assign(Object.create(baseContext.env.Sandbox), {
              getByName: (sandboxId: string) => {
                const stub = baseContext.env.Sandbox.getByName(sandboxId);
                if (sandboxId !== accepted.runId) {
                  return stub;
                }

                return Object.assign(Object.create(stub), {
                  setKeepAlive: vi.fn(async () => {}),
                  destroy: vi.fn(async () => {
                    throw new Error("sandbox still reachable");
                  }),
                });
              },
            }),
          }) as Env,
        };

        await expect(reconcileActiveRunWatchdog(context, project.id)).resolves.toBe(accepted.runId);

        const retryState = await getSandboxCleanupRetryState(baseContext, accepted.runId);
        expect(retryState?.attempt).toBe(1);
        expect(retryState?.nextAt ?? 0).toBeGreaterThan(Date.now());
      });
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("marks a run failed after repeated dispatch enqueue failures", async () => {
    const baseTime = 1_720_000_000_000;
    const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => baseTime);

    try {
      const user = await seedUser({
        email: "dispatch@example.com",
        slug: "dispatch-user",
      });
      const project = await seedProject(user, {
        projectSlug: "dispatch-project",
        dispatchMode: "queue",
      });
      const projectStub = env.PROJECT_DO.getByName(project.id);
      const accepted = await acceptManualRunWithoutAlarm(projectStub, {
        projectId: project.id,
        triggeredByUserId: user.id,
        branch: project.defaultBranch,
      });

      await runInDurableObject(projectStub, async (instance: ProjectDO) => {
        const baseContext = createTestProjectDoContext(instance);
        const context: ProjectDoContext = {
          ...baseContext,
          env: Object.assign(Object.create(baseContext.env), {
            RUN_QUEUE: {
              send: async () => {
                throw new Error("queue unavailable");
              },
            },
          }) as Env,
        };
        await baseContext.ctx.storage.deleteAlarm();

        await reconcileAcceptedRunD1Sync(context, project.id);

        for (let attempt = 0; attempt <= DISPATCH_RETRY_DELAYS_MS.length; attempt += 1) {
          await dispatchExecutableRun(context, project.id);
          if (attempt < DISPATCH_RETRY_DELAYS_MS.length) {
            nowSpy.mockImplementation(
              () =>
                baseTime + DISPATCH_RETRY_DELAYS_MS.slice(0, attempt + 1).reduce((sum, delay) => sum + delay + 1, 0),
            );
          }
        }

        await reconcileTerminalRunD1Sync(context, project.id);
      });

      const rows = await readProjectDoRows(project.id);
      expect(rows.runs[0]?.status).toBe("failed");
      expect(rows.runs[0]?.dispatchStatus).toBe("terminal");
      expect(rows.runs[0]?.lastError).toBe("dispatch_failed");

      const runMeta = await env.RUN_DO.getByName(accepted.runId).getRunSummary(accepted.runId);
      expect(runMeta?.status).toBe("failed");
      expect(runMeta?.errorMessage).toBe("dispatch_failed");
      expect(runMeta?.startedAt).toBeNull();

      const db = createD1Db(env.DB);
      const d1Row = await db.select().from(d1Schema.runIndex).where(eq(d1Schema.runIndex.id, accepted.runId)).limit(1);
      expect(d1Row[0]?.status).toBe("failed");
      expect(d1Row[0]?.startedAt).toBeNull();
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("starts a Workflows instance when the run dispatch mode is workflows", async () => {
    const user = await seedUser({
      email: "workflow-dispatch@example.com",
      slug: "workflow-dispatch-user",
    });
    const project = await seedProject(user, {
      projectSlug: "workflow-dispatch-project",
      dispatchMode: "workflows",
    });
    const projectStub = env.PROJECT_DO.getByName(project.id);
    const accepted = await acceptManualRunWithoutAlarm(projectStub, {
      projectId: project.id,
      triggeredByUserId: user.id,
      branch: project.defaultBranch,
    });

    await runInDurableObject(projectStub, async (instance: ProjectDO) => {
      const baseContext = createTestProjectDoContext(instance);
      const createBatch = vi.fn(async () => [{ id: accepted.runId }]);
      const context: ProjectDoContext = {
        ...baseContext,
        env: Object.assign(Object.create(baseContext.env), {
          RUN_WORKFLOWS: {
            createBatch,
            get: vi.fn(),
          },
        }) as Env,
      };
      await baseContext.ctx.storage.deleteAlarm();

      await dispatchExecutableRun(context, project.id);

      expect(createBatch).toHaveBeenCalledWith([
        expect.objectContaining({
          id: accepted.runId,
          params: expect.objectContaining({
            runId: accepted.runId,
            projectId: project.id,
            dispatchMode: "workflows",
            executionRuntime: DEFAULT_EXECUTION_RUNTIME,
          }),
        }),
      ]);
    });

    const rows = await readProjectDoRows(project.id);
    expect(rows.runs[0]?.dispatchStatus).toBe("queued");
  });

  it.each([
    {
      workflowStatus: "errored" as const,
      expectedError: "reached terminal status errored",
    },
    {
      workflowStatus: "terminated" as const,
      expectedError: "reached terminal status terminated",
    },
  ])(
    "rearms a queued workflow dispatch when the retained instance is $workflowStatus",
    async ({ workflowStatus, expectedError }) => {
      const user = await seedUser({
        email: `workflow-${workflowStatus}-queued@example.com`,
        slug: `workflow-${workflowStatus}-queued-user`,
      });
      const project = await seedProject(user, {
        projectSlug: `workflow-${workflowStatus}-queued-project`,
        dispatchMode: "workflows",
      });
      const projectStub = env.PROJECT_DO.getByName(project.id);
      const accepted = await acceptManualRunWithoutAlarm(projectStub, {
        projectId: project.id,
        triggeredByUserId: user.id,
        branch: project.defaultBranch,
      });

      await runInDurableObject(projectStub, async (instance: ProjectDO) => {
        const baseContext = createTestProjectDoContext(instance);
        const status = vi.fn(async () => ({
          status: workflowStatus,
        }));
        const context: ProjectDoContext = {
          ...baseContext,
          env: Object.assign(Object.create(baseContext.env), {
            RUN_WORKFLOWS: {
              createBatch: vi.fn(async () => [{ id: accepted.runId }]),
              get: vi.fn(async () => ({
                status,
                restart: vi.fn(async () => {}),
              })),
            },
          }) as Env,
        };
        await baseContext.ctx.storage.deleteAlarm();

        await dispatchExecutableRun(context, project.id);
        await expect(dispatchExecutableRun(context, project.id)).resolves.toBeNull();

        const retryAt = await getDispatchRetryAt(baseContext, accepted.runId);
        expect(retryAt ?? 0).toBeGreaterThan(Date.now());
      });

      const rows = await readProjectDoRows(project.id);
      expect(rows.runs[0]?.status).toBe("executable");
      expect(rows.runs[0]?.dispatchStatus).toBe("pending");
      expect(rows.runs[0]?.dispatchAttempts).toBe(1);
      expect(rows.runs[0]?.lastError).toContain(expectedError);
    },
  );

  it("rearms a queued workflow dispatch when workflow status inspection fails", async () => {
    const user = await seedUser({
      email: "workflow-queued-status-throw@example.com",
      slug: "workflow-queued-status-throw-user",
    });
    const project = await seedProject(user, {
      projectSlug: "workflow-queued-status-throw-project",
      dispatchMode: "workflows",
    });
    const projectStub = env.PROJECT_DO.getByName(project.id);
    const accepted = await acceptManualRunWithoutAlarm(projectStub, {
      projectId: project.id,
      triggeredByUserId: user.id,
      branch: project.defaultBranch,
    });

    await runInDurableObject(projectStub, async (instance: ProjectDO) => {
      const baseContext = createTestProjectDoContext(instance);
      const context: ProjectDoContext = {
        ...baseContext,
        env: Object.assign(Object.create(baseContext.env), {
          RUN_WORKFLOWS: {
            createBatch: vi.fn(async () => [{ id: accepted.runId }]),
            get: vi.fn(async () => ({
              status: vi.fn(async () => {
                throw new Error("workflow status unavailable");
              }),
              restart: vi.fn(async () => {}),
            })),
          },
        }) as Env,
      };
      await baseContext.ctx.storage.deleteAlarm();

      await dispatchExecutableRun(context, project.id);
      await expect(dispatchExecutableRun(context, project.id)).resolves.toBeNull();

      const retryAt = await getDispatchRetryAt(baseContext, accepted.runId);
      expect(retryAt ?? 0).toBeGreaterThan(Date.now());
    });

    const rows = await readProjectDoRows(project.id);
    expect(rows.runs[0]?.status).toBe("executable");
    expect(rows.runs[0]?.dispatchStatus).toBe("pending");
    expect(rows.runs[0]?.dispatchAttempts).toBe(1);
    expect(rows.runs[0]?.lastError).toContain("workflow status unavailable");
  });

  it("preserves a workflow dispatch retry when the workflow rearms itself before dispatch returns", async () => {
    const baseTime = 1_730_500_000_000;
    const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => baseTime);

    try {
      const user = await seedUser({
        email: "workflow-fast-failure@example.com",
        slug: "workflow-fast-failure-user",
      });
      const project = await seedProject(user, {
        projectSlug: "workflow-fast-failure-project",
        dispatchMode: "workflows",
      });
      const projectStub = env.PROJECT_DO.getByName(project.id);
      const accepted = await acceptManualRunWithoutAlarm(projectStub, {
        projectId: project.id,
        triggeredByUserId: user.id,
        branch: project.defaultBranch,
      });

      await runInDurableObject(projectStub, async (instance: ProjectDO) => {
        const baseContext = createTestProjectDoContext(instance);
        let context: ProjectDoContext;
        context = {
          ...baseContext,
          env: Object.assign(Object.create(baseContext.env), {
            RUN_WORKFLOWS: {
              createBatch: vi.fn(async () => {
                const recovery = await recoverWorkflowDispatchFailure(baseContext, {
                  projectId: project.id,
                  runId: accepted.runId,
                  errorMessage: "claim exploded",
                });
                expect(recovery).toEqual({
                  kind: "rearmed",
                });
                return [{ id: accepted.runId }];
              }),
              get: vi.fn(),
            },
          }) as Env,
        };
        await baseContext.ctx.storage.deleteAlarm();

        await dispatchExecutableRun(context, project.id);

        const retryAt = await getDispatchRetryAt(baseContext, accepted.runId);
        expect(retryAt ?? 0).toBeGreaterThan(Date.now());
      });

      const rows = await readProjectDoRows(project.id);
      expect(rows.runs[0]?.status).toBe("executable");
      expect(rows.runs[0]?.dispatchStatus).toBe("pending");
      expect(rows.runs[0]?.dispatchAttempts).toBe(1);
      expect(rows.runs[0]?.lastError).toBe("claim exploded");
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("restarts an existing Workflows instance after a rearmed pre-active failure", async () => {
    const baseTime = 1_730_000_000_000;
    const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => baseTime);
    try {
      const user = await seedUser({
        email: "workflow-restart@example.com",
        slug: "workflow-restart-user",
      });
      const project = await seedProject(user, {
        projectSlug: "workflow-restart-project",
        dispatchMode: "workflows",
      });
      const projectStub = env.PROJECT_DO.getByName(project.id);
      const accepted = await acceptManualRunWithoutAlarm(projectStub, {
        projectId: project.id,
        triggeredByUserId: user.id,
        branch: project.defaultBranch,
      });

      await runInDurableObject(projectStub, async (instance: ProjectDO) => {
        const baseContext = createTestProjectDoContext(instance);
        const restart = vi.fn(async () => {});
        const context: ProjectDoContext = {
          ...baseContext,
          env: Object.assign(Object.create(baseContext.env), {
            RUN_WORKFLOWS: {
              createBatch: vi.fn(async () => [{ id: accepted.runId }]),
              get: vi.fn(async () => ({
                restart,
              })),
            },
          }) as Env,
        };
        await baseContext.ctx.storage.deleteAlarm();

        await dispatchExecutableRun(context, project.id);
        const recovery = await recoverWorkflowDispatchFailure(context, {
          projectId: project.id,
          runId: accepted.runId,
          errorMessage: "claim exploded",
        });
        expect(recovery).toEqual({
          kind: "rearmed",
        });
        nowSpy.mockImplementation(() => baseTime + DISPATCH_RETRY_DELAYS_MS[0] + 1);

        await dispatchExecutableRun(
          {
            ...context,
            env: Object.assign(Object.create(context.env), {
              RUN_WORKFLOWS: {
                createBatch: vi.fn(async () => []),
                get: vi.fn(async () => ({
                  status: vi.fn(async () => ({
                    status: "complete" as const,
                  })),
                  restart,
                })),
              },
            }) as Env,
          },
          project.id,
        );

        expect(restart).toHaveBeenCalledTimes(1);
      });
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("does not restart an already-running Workflows instance when dispatch is replayed", async () => {
    const user = await seedUser({
      email: "workflow-running@example.com",
      slug: "workflow-running-user",
    });
    const project = await seedProject(user, {
      projectSlug: "workflow-running-project",
      dispatchMode: "workflows",
    });
    const projectStub = env.PROJECT_DO.getByName(project.id);
    const accepted = await acceptManualRunWithoutAlarm(projectStub, {
      projectId: project.id,
      triggeredByUserId: user.id,
      branch: project.defaultBranch,
    });

    await runInDurableObject(projectStub, async (instance: ProjectDO) => {
      const baseContext = createTestProjectDoContext(instance);
      const restart = vi.fn(async () => {});
      const status = vi.fn(async () => ({
        status: "running" as const,
      }));
      const context: ProjectDoContext = {
        ...baseContext,
        env: Object.assign(Object.create(baseContext.env), {
          RUN_WORKFLOWS: {
            createBatch: vi.fn(async () => []),
            get: vi.fn(async () => ({
              status,
              restart,
            })),
          },
        }) as Env,
      };
      await baseContext.ctx.storage.deleteAlarm();

      await dispatchExecutableRun(context, project.id);

      expect(status).toHaveBeenCalledTimes(1);
      expect(restart).not.toHaveBeenCalled();
    });

    const rows = await readProjectDoRows(project.id);
    expect(rows.runs[0]?.dispatchStatus).toBe("queued");
  });

  it.each(["paused", "waitingForPause"] as const)(
    "does not restart a retained Workflows instance when dispatch is replayed in %s state",
    async (workflowStatus) => {
      const user = await seedUser({
        email: `workflow-${workflowStatus.toLowerCase()}@example.com`,
        slug: `workflow-${workflowStatus.toLowerCase()}-user`,
      });
      const project = await seedProject(user, {
        projectSlug: `workflow-${workflowStatus.toLowerCase()}-project`,
        dispatchMode: "workflows",
      });
      const projectStub = env.PROJECT_DO.getByName(project.id);
      const accepted = await acceptManualRunWithoutAlarm(projectStub, {
        projectId: project.id,
        triggeredByUserId: user.id,
        branch: project.defaultBranch,
      });

      await runInDurableObject(projectStub, async (instance: ProjectDO) => {
        const baseContext = createTestProjectDoContext(instance);
        const restart = vi.fn(async () => {});
        const status = vi.fn(async () => ({
          status: workflowStatus,
        }));
        const context: ProjectDoContext = {
          ...baseContext,
          env: Object.assign(Object.create(baseContext.env), {
            RUN_WORKFLOWS: {
              createBatch: vi.fn(async () => []),
              get: vi.fn(async () => ({
                status,
                restart,
              })),
            },
          }) as Env,
        };
        await baseContext.ctx.storage.deleteAlarm();

        await dispatchExecutableRun(context, project.id);

        expect(status).toHaveBeenCalledTimes(1);
        expect(restart).not.toHaveBeenCalled();
      });

      const rows = await readProjectDoRows(project.id);
      expect(rows.runs[0]?.dispatchStatus).toBe("queued");
    },
  );

  it("keeps workflow dispatch pending when an existing instance has an unsupported status", async () => {
    const user = await seedUser({
      email: "workflow-unknown@example.com",
      slug: "workflow-unknown-user",
    });
    const project = await seedProject(user, {
      projectSlug: "workflow-unknown-project",
      dispatchMode: "workflows",
    });
    const projectStub = env.PROJECT_DO.getByName(project.id);
    await acceptManualRunWithoutAlarm(projectStub, {
      projectId: project.id,
      triggeredByUserId: user.id,
      branch: project.defaultBranch,
    });

    await runInDurableObject(projectStub, async (instance: ProjectDO) => {
      const baseContext = createTestProjectDoContext(instance);
      const context: ProjectDoContext = {
        ...baseContext,
        env: Object.assign(Object.create(baseContext.env), {
          RUN_WORKFLOWS: {
            createBatch: vi.fn(async () => []),
            get: vi.fn(async () => ({
              status: vi.fn(async () => ({
                status: "unknown" as const,
              })),
              restart: vi.fn(async () => {}),
            })),
          },
        }) as Env,
      };
      await baseContext.ctx.storage.deleteAlarm();

      await expect(dispatchExecutableRun(context, project.id)).resolves.toBeNull();
    });

    const rows = await readProjectDoRows(project.id);
    expect(rows.runs[0]?.dispatchStatus).toBe("pending");
    expect(rows.runs[0]?.dispatchAttempts).toBe(1);
    expect(rows.runs[0]?.lastError).toContain("unsupported status unknown");
  });
});
