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
import { getSandboxCleanupRetryState } from "@/worker/durable/project-do/sidecar-state";
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
});
