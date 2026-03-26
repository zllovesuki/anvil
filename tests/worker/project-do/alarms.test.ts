import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import { BranchName, CommitSha, DEFAULT_DISPATCH_MODE, DEFAULT_EXECUTION_RUNTIME } from "@/contracts";
import {
  PROJECT_ALARM_MAX_ITERATIONS,
  PROJECT_RECONCILIATION_LIVENESS_FALLBACK_MS,
} from "@/worker/durable/project-do/constants";
import * as projectDoSchema from "@/worker/db/durable/schema/project-do";
import { ProjectDO } from "@/worker/durable";
import {
  acceptManualRun as acceptManualRunCommand,
  claimRunWork as claimRunWorkCommand,
  finalizeRunExecution as finalizeRunExecutionCommand,
  recordRunResolvedCommit as recordRunResolvedCommitCommand,
  requestRunCancel as requestRunCancelCommand,
} from "@/worker/durable/project-do/commands";
import * as reconciliationModule from "@/worker/durable/project-do/reconciliation";
import * as sidecarState from "@/worker/durable/project-do/sidecar-state";
import { createLogger } from "@/worker/services/logger";

import {
  acceptManualRunWithoutAlarm,
  claimRunWorkWithoutAlarm,
  createAlarmWriteFailingContext,
  createBoundStorageProxy,
  createTestProjectDoContext,
  expectAcceptedManualRun,
  getProjectDoInternals,
  withPatchedStorage,
} from "../../helpers/project-do";
import { registerWorkerRuntimeHooks } from "../../helpers/worker-hooks";
import { readProjectDoRows, seedProject, seedUser } from "../../helpers/runtime";

describe("ProjectDO alarm behavior", () => {
  registerWorkerRuntimeHooks();

  describe("arming fallbacks", () => {
    it("arms a fallback alarm when non-terminal rows have no immediate reconciliation candidate", async () => {
      const user = await seedUser({
        email: "fallback@example.com",
        slug: "fallback-user",
      });
      const project = await seedProject(user, {
        projectSlug: "fallback-project",
      });
      const projectStub = env.PROJECT_DO.getByName(project.id);

      const accepted = await acceptManualRunWithoutAlarm(projectStub, {
        projectId: project.id,
        triggeredByUserId: user.id,
        branch: project.defaultBranch,
      });

      await runInDurableObject(projectStub, async (instance: ProjectDO) => {
        const { ctx, env: durableEnv, db } = createTestProjectDoContext(instance);

        await db
          .update(projectDoSchema.projectRuns)
          .set({
            status: "executable",
            dispatchStatus: "queued",
            d1SyncStatus: "current",
          })
          .where(eq(projectDoSchema.projectRuns.runId, accepted.runId));
        await ctx.storage.deleteAlarm();

        const before = Date.now();
        await sidecarState.rescheduleAlarm(
          {
            ctx,
            env: durableEnv,
            db,
            logger: createLogger("test.project-do"),
            cacheProjectId: () => {},
          },
          project.id,
        );

        const alarmAt = await ctx.storage.getAlarm();
        expect(alarmAt).not.toBeNull();
        expect(alarmAt as number).toBeGreaterThanOrEqual(before + PROJECT_RECONCILIATION_LIVENESS_FALLBACK_MS - 2_000);
        expect(alarmAt as number).toBeLessThanOrEqual(Date.now() + PROJECT_RECONCILIATION_LIVENESS_FALLBACK_MS + 2_000);
      });
    });

    it("falls back to a direct setAlarm when getAlarm fails during reconciliation arming", async () => {
      const user = await seedUser({
        email: "direct-fallback@example.com",
        slug: "direct-fallback-user",
      });
      const project = await seedProject(user, {
        projectSlug: "direct-fallback-project",
      });
      const projectStub = env.PROJECT_DO.getByName(project.id);

      expectAcceptedManualRun(
        await projectStub.acceptManualRun({
          projectId: project.id,
          triggeredByUserId: user.id,
          branch: project.defaultBranch,
        }),
      );

      await runInDurableObject(projectStub, async (instance: ProjectDO) => {
        const baseContext = createTestProjectDoContext(instance);
        const alarmWrites: number[] = [];
        const getAlarm: DurableObjectStorage["getAlarm"] = async () => {
          throw new Error("getAlarm failed");
        };
        const setAlarm: DurableObjectStorage["setAlarm"] = async (scheduledTime, options) => {
          alarmWrites.push(Number(scheduledTime));
          await baseContext.ctx.storage.setAlarm(scheduledTime, options);
        };
        const storage = createBoundStorageProxy(baseContext.ctx.storage, { getAlarm, setAlarm });
        const context = withPatchedStorage(baseContext, storage);

        await expect(sidecarState.armReconciliation(context, project.id)).resolves.toBeUndefined();
        expect(alarmWrites).toHaveLength(1);
        expect(alarmWrites[0]).toBeGreaterThanOrEqual(Date.now() - 2_000);
        expect(alarmWrites[0]).toBeLessThanOrEqual(Date.now() + 2_000);
      });
    });
  });

  describe("sandbox cleanup retries", () => {
    it("clears retry state after a successful alarm-driven sandbox cleanup", async () => {
      const user = await seedUser({
        email: "sandbox-cleanup-success@example.com",
        slug: "sandbox-cleanup-success-user",
      });
      const project = await seedProject(user, {
        projectSlug: "sandbox-cleanup-success-project",
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

      await runInDurableObject(projectStub, async (instance: ProjectDO) => {
        const baseContext = createTestProjectDoContext(instance);
        await finalizeRunExecutionCommand(baseContext, {
          projectId: project.id,
          runId: accepted.runId,
          terminalStatus: "failed",
          lastError: "cleanup_pending",
          sandboxDestroyed: false,
        });
        await sidecarState.setSandboxCleanupRetryState(baseContext, accepted.runId, {
          attempt: 1,
          nextAt: Date.now() - 1,
        });

        const setKeepAlive = vi.fn(async () => {});
        const destroy = vi.fn(async () => {});
        const context = createTestProjectDoContext(
          instance,
          Object.assign(Object.create(baseContext.env), {
            Sandbox: Object.assign(Object.create(baseContext.env.Sandbox), {
              getByName: (sandboxId: string) => {
                const stub = baseContext.env.Sandbox.getByName(sandboxId);
                if (sandboxId !== accepted.runId) {
                  return stub;
                }

                return Object.assign(Object.create(stub), {
                  setKeepAlive,
                  destroy,
                });
              },
            }),
          }) as Env,
        );

        await expect(reconciliationModule.reconcileSandboxCleanup(context, project.id)).resolves.toBe(accepted.runId);
        expect(setKeepAlive).toHaveBeenCalledWith(false);
        expect(destroy).toHaveBeenCalledTimes(1);
        expect(await sidecarState.getSandboxCleanupRetryState(baseContext, accepted.runId)).toBeNull();
      });
    });
  });

  describe("rollback on alarm persistence failure", () => {
    it("rolls back acceptManualRun when reconciliation alarm persistence fails", async () => {
      const user = await seedUser({
        email: "sidecar-arm@example.com",
        slug: "sidecar-arm-user",
      });
      const project = await seedProject(user, {
        projectSlug: "sidecar-arm-project",
      });
      const projectStub = env.PROJECT_DO.getByName(project.id);

      await runInDurableObject(projectStub, async (instance: ProjectDO) => {
        const context = createAlarmWriteFailingContext(createTestProjectDoContext(instance));

        await expect(
          acceptManualRunCommand(context, {
            projectId: project.id,
            triggeredByUserId: user.id,
            branch: project.defaultBranch,
          }),
        ).rejects.toThrow("alarm write failed");
      });

      const rows = await readProjectDoRows(project.id);
      expect(rows.state).toMatchObject({
        projectId: project.id,
        activeRunId: null,
        projectIndexSyncStatus: "current",
      });
      expect(rows.config).not.toBeNull();
      expect(rows.runs).toEqual([]);
    });

    it("rolls back finalizeRunExecution when promoting the next run cannot persist an alarm", async () => {
      const user = await seedUser({
        email: "finalize-arm-failure@example.com",
        slug: "finalize-arm-failure-user",
      });
      const project = await seedProject(user, {
        projectSlug: "finalize-arm-failure-project",
        dispatchMode: "queue",
      });
      const projectStub = env.PROJECT_DO.getByName(project.id);

      const firstAccepted = expectAcceptedManualRun(
        await projectStub.acceptManualRun({
          projectId: project.id,
          triggeredByUserId: user.id,
          branch: project.defaultBranch,
        }),
      );
      const secondAccepted = expectAcceptedManualRun(
        await projectStub.acceptManualRun({
          projectId: project.id,
          triggeredByUserId: user.id,
          branch: BranchName.assertDecode("release"),
        }),
      );
      const claim = await projectStub.claimRunWork({
        projectId: project.id,
        runId: firstAccepted.runId,
      });
      expect(claim.kind).toBe("execute");

      await runInDurableObject(projectStub, async (instance: ProjectDO) => {
        const context = createAlarmWriteFailingContext(createTestProjectDoContext(instance));
        await context.ctx.storage.deleteAlarm();

        await expect(
          finalizeRunExecutionCommand(context, {
            projectId: project.id,
            runId: firstAccepted.runId,
            terminalStatus: "passed",
            lastError: null,
            sandboxDestroyed: true,
          }),
        ).rejects.toThrow("alarm write failed");
      });

      const rows = await readProjectDoRows(project.id);
      expect(rows.state?.activeRunId).toBe(firstAccepted.runId);
      expect(
        rows.runs.map((row) => ({ runId: row.runId, status: row.status, dispatchStatus: row.dispatchStatus })),
      ).toEqual([
        {
          runId: firstAccepted.runId,
          status: "active",
          dispatchStatus: "started",
        },
        {
          runId: secondAccepted.runId,
          status: "pending",
          dispatchStatus: "blocked",
        },
      ]);
    });

    it("rolls back requestRunCancel when promotion cannot persist a replacement alarm", async () => {
      const user = await seedUser({
        email: "cancel-arm-failure@example.com",
        slug: "cancel-arm-failure-user",
      });
      const project = await seedProject(user, {
        projectSlug: "cancel-arm-failure-project",
      });
      const projectStub = env.PROJECT_DO.getByName(project.id);

      const firstAccepted = await acceptManualRunWithoutAlarm(projectStub, {
        projectId: project.id,
        triggeredByUserId: user.id,
        branch: project.defaultBranch,
      });
      const secondAccepted = await acceptManualRunWithoutAlarm(projectStub, {
        projectId: project.id,
        triggeredByUserId: user.id,
        branch: BranchName.assertDecode("feature-x"),
      });

      await runInDurableObject(projectStub, async (instance: ProjectDO) => {
        const context = createAlarmWriteFailingContext(createTestProjectDoContext(instance));

        await expect(
          requestRunCancelCommand(context, {
            projectId: project.id,
            runId: firstAccepted.runId,
          }),
        ).rejects.toThrow("alarm write failed");
      });

      const rows = await readProjectDoRows(project.id);
      expect(rows.state?.activeRunId).toBeNull();
      expect(
        rows.runs.map((row) => ({ runId: row.runId, status: row.status, dispatchStatus: row.dispatchStatus })),
      ).toEqual([
        {
          runId: firstAccepted.runId,
          status: "executable",
          dispatchStatus: "pending",
        },
        {
          runId: secondAccepted.runId,
          status: "pending",
          dispatchStatus: "blocked",
        },
      ]);
    });

    it("rolls back recordRunResolvedCommit when alarm persistence fails", async () => {
      const user = await seedUser({
        email: "resolved-commit-arm-failure@example.com",
        slug: "resolved-commit-arm-failure-user",
      });
      const project = await seedProject(user, {
        projectSlug: "resolved-commit-arm-failure-project",
      });
      const projectStub = env.PROJECT_DO.getByName(project.id);

      const accepted = await acceptManualRunWithoutAlarm(projectStub, {
        projectId: project.id,
        triggeredByUserId: user.id,
        branch: project.defaultBranch,
      });
      const claim = await claimRunWorkWithoutAlarm(projectStub, {
        projectId: project.id,
        runId: accepted.runId,
      });
      expect(claim.kind).toBe("execute");
      const commitSha = CommitSha.assertDecode("0123456789abcdef0123456789abcdef01234567");

      await runInDurableObject(projectStub, async (instance: ProjectDO) => {
        const context = createAlarmWriteFailingContext(createTestProjectDoContext(instance));

        await expect(
          recordRunResolvedCommitCommand(context, {
            projectId: project.id,
            runId: accepted.runId,
            commitSha,
          }),
        ).rejects.toThrow("alarm write failed");
      });

      const rows = await readProjectDoRows(project.id);
      expect(rows.runs[0]).toMatchObject({
        runId: accepted.runId,
        commitSha: null,
        d1SyncStatus: "needs_create",
      });
    });

    it("rolls back claimRunWork when alarm persistence fails", async () => {
      const user = await seedUser({
        email: "claim-arm-failure@example.com",
        slug: "claim-arm-failure-user",
      });
      const project = await seedProject(user, {
        projectSlug: "claim-arm-failure-project",
      });
      const projectStub = env.PROJECT_DO.getByName(project.id);

      const accepted = await acceptManualRunWithoutAlarm(projectStub, {
        projectId: project.id,
        triggeredByUserId: user.id,
        branch: project.defaultBranch,
      });

      await runInDurableObject(projectStub, async (instance: ProjectDO) => {
        const context = createAlarmWriteFailingContext(createTestProjectDoContext(instance));

        await expect(
          claimRunWorkCommand(context, {
            projectId: project.id,
            runId: accepted.runId,
          }),
        ).rejects.toThrow("alarm write failed");
      });

      const rows = await readProjectDoRows(project.id);
      expect(rows.state?.activeRunId).toBeNull();
      expect(rows.runs[0]).toMatchObject({
        runId: accepted.runId,
        status: "executable",
        dispatchStatus: "pending",
      });
    });
  });

  describe("alarm iteration limits", () => {
    it("caps each alarm invocation and leaves follow-up work scheduled", async () => {
      const user = await seedUser({
        email: "alarm-cap@example.com",
        slug: "alarm-cap-user",
      });
      const project = await seedProject(user, {
        projectSlug: "alarm-cap-project",
      });
      const projectStub = env.PROJECT_DO.getByName(project.id);
      const accepted = await acceptManualRunWithoutAlarm(projectStub, {
        projectId: project.id,
        triggeredByUserId: user.id,
        branch: project.defaultBranch,
      });
      const cycleSpy = vi
        .spyOn(reconciliationModule, "runAlarmCycle")
        .mockResolvedValue({ action: "promote_pending", runId: accepted.runId });

      try {
        await runInDurableObject(projectStub, async (instance: ProjectDO) => {
          const { ctx } = getProjectDoInternals(instance);
          await ctx.storage.deleteAlarm();
          await instance.alarm();
          expect(await ctx.storage.getAlarm()).not.toBeNull();
        });

        expect(cycleSpy).toHaveBeenCalledTimes(PROJECT_ALARM_MAX_ITERATIONS);
      } finally {
        cycleSpy.mockRestore();
      }
    });
  });
});
