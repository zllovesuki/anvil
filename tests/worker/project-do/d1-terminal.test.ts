import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import { CommitSha, DEFAULT_DISPATCH_MODE, DEFAULT_EXECUTION_RUNTIME } from "@/contracts";
import { expectTrusted, PositiveInteger } from "@/worker/contracts";
import { D1_RETRY_DELAYS_MS } from "@/worker/durable/project-do/constants";
import { createD1Db } from "@/worker/db/d1";
import * as d1Schema from "@/worker/db/d1/schema";
import * as projectDoSchema from "@/worker/db/durable/schema/project-do";
import { ProjectDO } from "@/worker/durable";
import { recordRunResolvedCommit as recordRunResolvedCommitCommand } from "@/worker/durable/project-do/commands";
import { reconcileAcceptedRunD1Sync, reconcileTerminalRunD1Sync } from "@/worker/durable/project-do/reconciliation";
import * as sidecarState from "@/worker/durable/project-do/sidecar-state";

import {
  acceptManualRunWithoutAlarm,
  claimRunWorkWithoutAlarm,
  createTestProjectDoContext,
  expectAcceptedManualRun,
  finalizeRunExecutionWithoutAlarm,
  requestRunCancelWithoutAlarm,
} from "../../helpers/project-do";
import { registerWorkerRuntimeHooks } from "../../helpers/worker-hooks";
import { readProjectDoRows, seedProject, seedUser } from "../../helpers/runtime";

describe("ProjectDO terminal D1 synchronization", () => {
  registerWorkerRuntimeHooks();

  describe("post-terminal metadata guards", () => {
    it("rejects resolved-commit backfill after terminal sync", async () => {
      const user = await seedUser({
        email: "commit-backfill-after-done@example.com",
        slug: "commit-backfill-after-done-user",
      });
      const project = await seedProject(user, {
        projectSlug: "commit-backfill-after-done-project",
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

      await runInDurableObject(projectStub, async (instance: ProjectDO) => {
        const context = createTestProjectDoContext(instance);

        await reconcileAcceptedRunD1Sync(context, project.id);
      });

      await projectStub.finalizeRunExecution({
        projectId: project.id,
        runId: accepted.runId,
        terminalStatus: "failed",
        lastError: "checkout_failed",
        sandboxDestroyed: true,
      });

      await runInDurableObject(projectStub, async (instance: ProjectDO) => {
        const context = createTestProjectDoContext(instance);

        await reconcileTerminalRunD1Sync(context, project.id);
      });

      const commitSha = CommitSha.assertDecode("1111111111111111111111111111111111111111");
      await expect(
        projectStub.recordRunResolvedCommit({
          projectId: project.id,
          runId: accepted.runId,
          commitSha,
        }),
      ).resolves.toEqual({
        kind: "stale",
        status: "failed",
      });

      const rows = await readProjectDoRows(project.id);
      expect(rows.runs[0]).toMatchObject({
        runId: accepted.runId,
        status: "failed",
        commitSha: null,
        d1SyncStatus: "done",
      });

      const db = createD1Db(env.DB);
      const d1Row = await db.select().from(d1Schema.runIndex).where(eq(d1Schema.runIndex.id, accepted.runId)).limit(1);
      expect(d1Row[0]).toMatchObject({
        commitSha: null,
        status: "failed",
      });
      expect(d1Row[0]?.finishedAt).not.toBeNull();
      expect(d1Row[0]?.exitCode).toBe(1);
    });
  });

  describe("retry normalization", () => {
    it("does not let terminal D1 reconciliation wait on a stale metadata retry window", async () => {
      const user = await seedUser({
        email: "terminal-retry-window@example.com",
        slug: "terminal-retry-window-user",
      });
      const project = await seedProject(user, {
        projectSlug: "terminal-retry-window-project",
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
        const context = createTestProjectDoContext(instance);

        await reconcileAcceptedRunD1Sync(context, project.id);
      });

      const commitSha = CommitSha.assertDecode("abcdef0123456789abcdef0123456789abcdef01");
      let remainingFailures = 2;

      await runInDurableObject(projectStub, async (instance: ProjectDO) => {
        const baseContext = createTestProjectDoContext(instance);
        const failingEnv = Object.assign(Object.create(baseContext.env), {
          RUN_DO: Object.assign(Object.create(baseContext.env.RUN_DO), {
            getByName: (runId: string) => {
              const stub = baseContext.env.RUN_DO.getByName(runId);
              if (runId !== accepted.runId) {
                return stub;
              }

              return Object.assign(Object.create(stub), {
                ensureInitialized: async (payload: { commitSha: string | null }) => {
                  if (payload.commitSha === commitSha && remainingFailures > 0) {
                    remainingFailures -= 1;
                    throw new Error("transient rundo reset");
                  }

                  await stub.ensureInitialized(payload as Parameters<typeof stub.ensureInitialized>[0]);
                },
              });
            },
          }),
        }) as Env;
        const context = createTestProjectDoContext(instance, failingEnv);

        await expect(
          recordRunResolvedCommitCommand(context, {
            projectId: project.id,
            runId: accepted.runId,
            commitSha,
          }),
        ).resolves.toEqual({
          kind: "applied",
        });
      });

      let metadataRetryAt: number | null = null;
      await runInDurableObject(projectStub, async (instance: ProjectDO) => {
        const context = createTestProjectDoContext(instance);
        const retryState = await sidecarState.getD1RetryState(context, accepted.runId);
        expect(retryState?.attempt).toBe(1);
        expect(retryState?.phase).toBe("metadata");
        metadataRetryAt = retryState?.nextAt ?? null;
        expect(metadataRetryAt).not.toBeNull();
        await context.ctx.storage.deleteAlarm();
      });

      await runInDurableObject(projectStub, async (instance: ProjectDO) => {
        const context = createTestProjectDoContext(instance);

        await context.db
          .update(projectDoSchema.projectRuns)
          .set({
            status: "failed",
            position: null,
            dispatchStatus: "terminal",
            d1SyncStatus: "needs_terminal_update",
            lastError: "checkout_failed",
          })
          .where(eq(projectDoSchema.projectRuns.runId, accepted.runId));
        await context.db
          .update(projectDoSchema.projectState)
          .set({
            activeRunId: null,
            updatedAt: Date.now(),
          })
          .where(eq(projectDoSchema.projectState.projectId, project.id));
        await context.ctx.storage.deleteAlarm();
        await sidecarState.rescheduleAlarm(context, project.id);

        const alarmAt = await context.ctx.storage.getAlarm();
        expect(alarmAt).not.toBeNull();
        expect(alarmAt as number).toBeLessThan(metadataRetryAt as number);
        expect(await reconcileTerminalRunD1Sync(context, project.id)).toBe(accepted.runId);
        expect(await sidecarState.getD1RetryState(context, accepted.runId)).toBeNull();
      });

      const runMeta = await env.RUN_DO.getByName(accepted.runId).getRunSummary(accepted.runId);
      expect(runMeta?.status).toBe("failed");
      expect(runMeta?.finishedAt).not.toBeNull();

      const rows = await readProjectDoRows(project.id);
      expect(rows.runs[0]?.status).toBe("failed");
      expect(rows.runs[0]?.d1SyncStatus).toBe("done");

      const db = createD1Db(env.DB);
      const d1Row = await db.select().from(d1Schema.runIndex).where(eq(d1Schema.runIndex.id, accepted.runId)).limit(1);
      expect(d1Row[0]?.commitSha).toBe(commitSha);
      expect(d1Row[0]?.status).toBe("failed");
      expect(d1Row[0]?.finishedAt).not.toBeNull();
      expect(d1Row[0]?.exitCode).toBe(1);
    });

    it("resets the terminal retry attempt when the stored retry came from metadata", async () => {
      const baseTime = 1_740_000_000_000;
      const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => baseTime);

      try {
        const user = await seedUser({
          email: "terminal-retry-reset@example.com",
          slug: "terminal-retry-reset-user",
        });
        const project = await seedProject(user, {
          projectSlug: "terminal-retry-reset-project",
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
          const context = createTestProjectDoContext(instance);

          await reconcileAcceptedRunD1Sync(context, project.id);
          await context.db
            .update(projectDoSchema.projectRuns)
            .set({
              status: "failed",
              position: null,
              dispatchStatus: "terminal",
              d1SyncStatus: "needs_terminal_update",
              lastError: "checkout_failed",
            })
            .where(eq(projectDoSchema.projectRuns.runId, accepted.runId));
          await context.db
            .update(projectDoSchema.projectState)
            .set({
              activeRunId: null,
              updatedAt: accepted.queuedAt,
            })
            .where(eq(projectDoSchema.projectState.projectId, project.id));
          await sidecarState.setD1RetryState(context, accepted.runId, {
            attempt: 3,
            nextAt: baseTime + 60_000,
            phase: "metadata",
          });

          const failingEnv = Object.assign(Object.create(context.env), {
            RUN_DO: Object.assign(Object.create(context.env.RUN_DO), {
              getByName: (runId: string) => {
                const stub = context.env.RUN_DO.getByName(runId);
                if (runId !== accepted.runId) {
                  return stub;
                }

                return Object.assign(Object.create(stub), {
                  getRunSummary: async () => null,
                  ensureInitialized: async () => {},
                  tryUpdateRunState: async () => {
                    throw new Error("terminal write failed");
                  },
                });
              },
            }),
          }) as Env;
          const failingContext = createTestProjectDoContext(instance, failingEnv);

          await expect(reconcileTerminalRunD1Sync(failingContext, project.id)).resolves.toBeNull();

          const retryState = await sidecarState.getD1RetryState(context, accepted.runId);
          expect(retryState).toEqual({
            attempt: 1,
            nextAt: baseTime + D1_RETRY_DELAYS_MS[0],
            phase: "terminal",
          });
        });
      } finally {
        nowSpy.mockRestore();
      }
    });

    it("ignores stored D1 retries that are missing a phase", async () => {
      const user = await seedUser({
        email: "retry-missing-phase@example.com",
        slug: "retry-missing-phase-user",
      });
      const project = await seedProject(user, {
        projectSlug: "retry-missing-phase-project",
      });
      const projectStub = env.PROJECT_DO.getByName(project.id);

      const accepted = await acceptManualRunWithoutAlarm(projectStub, {
        projectId: project.id,
        triggeredByUserId: user.id,
        branch: project.defaultBranch,
      });

      await runInDurableObject(projectStub, async (instance: ProjectDO) => {
        const context = createTestProjectDoContext(instance);
        const futureRetryAt = Date.now() + 60_000;

        await context.ctx.storage.put(sidecarState.d1RetryKey(accepted.runId), {
          attempt: 4,
          nextAt: futureRetryAt,
        });

        expect(await sidecarState.getD1RetryState(context, accepted.runId)).toBeNull();

        await sidecarState.rescheduleAlarm(context, project.id);

        const alarmAt = await context.ctx.storage.getAlarm();
        expect(alarmAt).not.toBeNull();
        expect(alarmAt as number).toBeLessThan(futureRetryAt);
      });
    });
  });

  describe("terminal reconciliation", () => {
    it("reconciles passed RunDO terminal state during terminal reconciliation", async () => {
      const user = await seedUser({
        email: "passed-fixup@example.com",
        slug: "passed-fixup-user",
      });
      const project = await seedProject(user, {
        projectSlug: "passed-fixup-project",
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

      await runInDurableObject(projectStub, async (instance: ProjectDO) => {
        const context = createTestProjectDoContext(instance);

        await reconcileAcceptedRunD1Sync(context, project.id);
      });

      const runStub = env.RUN_DO.getByName(accepted.runId);
      await runStub.updateRunState({
        runId: accepted.runId,
        status: "starting",
        currentStep: null,
        startedAt: accepted.queuedAt,
        finishedAt: null,
        exitCode: null,
        errorMessage: null,
      });
      await runStub.updateRunState({
        runId: accepted.runId,
        status: "running",
        currentStep: null,
        startedAt: accepted.queuedAt,
        finishedAt: null,
        exitCode: 0,
        errorMessage: null,
      });

      await finalizeRunExecutionWithoutAlarm(projectStub, {
        projectId: project.id,
        runId: accepted.runId,
        terminalStatus: "passed",
        lastError: null,
      });

      await runInDurableObject(projectStub, async (instance: ProjectDO) => {
        const context = createTestProjectDoContext(instance);

        await reconcileTerminalRunD1Sync(context, project.id);
      });

      const runMeta = await runStub.getRunSummary(accepted.runId);
      expect(runMeta?.status).toBe("passed");
      expect(runMeta?.finishedAt).not.toBeNull();

      const db = createD1Db(env.DB);
      const d1Row = await db.select().from(d1Schema.runIndex).where(eq(d1Schema.runIndex.id, accepted.runId)).limit(1);
      expect(d1Row[0]?.status).toBe("passed");
    });

    it("repairs the active step before reconciling canceled RunDO terminal state", async () => {
      const user = await seedUser({
        email: "canceled-step-repair@example.com",
        slug: "canceled-step-repair-user",
      });
      const project = await seedProject(user, {
        projectSlug: "canceled-step-repair-project",
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

      await runInDurableObject(projectStub, async (instance: ProjectDO) => {
        const context = createTestProjectDoContext(instance);

        await reconcileAcceptedRunD1Sync(context, project.id);
      });

      const stepPosition = expectTrusted(PositiveInteger, 1, "PositiveInteger");
      const runStub = env.RUN_DO.getByName(accepted.runId);
      await runStub.replaceSteps({
        runId: accepted.runId,
        steps: [
          {
            position: stepPosition,
            name: "Install",
            command: "npm ci",
          },
        ],
      });
      await runStub.updateRunState({
        runId: accepted.runId,
        status: "starting",
        currentStep: null,
        startedAt: accepted.queuedAt,
        finishedAt: null,
        exitCode: null,
        errorMessage: null,
      });
      await runStub.updateStepState({
        runId: accepted.runId,
        position: stepPosition,
        status: "running",
        startedAt: accepted.queuedAt,
        finishedAt: null,
        exitCode: null,
      });
      await runStub.updateRunState({
        runId: accepted.runId,
        status: "running",
        currentStep: stepPosition,
        startedAt: accepted.queuedAt,
        finishedAt: null,
        exitCode: null,
        errorMessage: null,
      });

      const cancelResult = await requestRunCancelWithoutAlarm(projectStub, {
        projectId: project.id,
        runId: accepted.runId,
      });
      expect(cancelResult.status).toBe("cancel_requested");

      await finalizeRunExecutionWithoutAlarm(projectStub, {
        projectId: project.id,
        runId: accepted.runId,
        terminalStatus: "canceled",
        lastError: null,
      });

      await runInDurableObject(projectStub, async (instance: ProjectDO) => {
        const context = createTestProjectDoContext(instance);

        await reconcileTerminalRunD1Sync(context, project.id);
      });

      const detail = await runStub.getRunDetail(accepted.runId);
      expect(detail.meta?.status).toBe("canceled");
      expect(detail.meta?.currentStep).toBeNull();
      expect(detail.steps[0]?.status).toBe("failed");
      expect(detail.steps[0]?.finishedAt).not.toBeNull();
      expect(detail.steps[0]?.exitCode).toBeNull();

      const db = createD1Db(env.DB);
      const d1Row = await db.select().from(d1Schema.runIndex).where(eq(d1Schema.runIndex.id, accepted.runId)).limit(1);
      expect(d1Row[0]?.status).toBe("canceled");
    });
  });
});
