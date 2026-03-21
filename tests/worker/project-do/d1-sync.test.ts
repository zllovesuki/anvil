import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import { CommitSha, DEFAULT_DISPATCH_MODE, DEFAULT_EXECUTION_RUNTIME, UnixTimestampMs } from "@/contracts";
import { expectTrusted } from "@/worker/contracts";
import { createD1Db } from "@/worker/db/d1";
import * as d1Repositories from "@/worker/db/d1/repositories";
import * as d1Schema from "@/worker/db/d1/schema";
import * as projectDoSchema from "@/worker/db/durable/schema/project-do";
import { ProjectDO } from "@/worker/durable";
import { recordRunResolvedCommit as recordRunResolvedCommitCommand } from "@/worker/durable/project-do/commands";
import {
  reconcileAcceptedRunD1Sync,
  reconcileRunMetadataD1Sync,
  reconcileTerminalRunD1Sync,
} from "@/worker/durable/project-do/reconciliation";
import * as sidecarState from "@/worker/durable/project-do/sidecar-state";

import {
  acceptManualRunWithoutAlarm,
  claimRunWorkWithoutAlarm,
  createTestProjectDoContext,
  expectAcceptedManualRun,
} from "../../helpers/project-do";
import { registerWorkerRuntimeHooks } from "../../helpers/worker-hooks";
import { readProjectDoRows, seedProject, seedUser } from "../../helpers/runtime";

describe("ProjectDO D1 synchronization", () => {
  registerWorkerRuntimeHooks();

  describe("resolved commit metadata backfill", () => {
    it("backfills a manual run commit SHA into ProjectDO, RunDO, and D1", async () => {
      const user = await seedUser({
        email: "commit-backfill@example.com",
        slug: "commit-backfill-user",
      });
      const project = await seedProject(user, {
        projectSlug: "commit-backfill-project",
      });
      const stub = env.PROJECT_DO.getByName(project.id);

      const accepted = await acceptManualRunWithoutAlarm(stub, {
        projectId: project.id,
        triggeredByUserId: user.id,
        branch: project.defaultBranch,
      });
      const claim = await claimRunWorkWithoutAlarm(stub, {
        projectId: project.id,
        runId: accepted.runId,
      });
      expect(claim.kind).toBe("execute");
      const commitSha = CommitSha.assertDecode("0123456789abcdef0123456789abcdef01234567");

      await expect(
        stub.recordRunResolvedCommit({
          projectId: project.id,
          runId: accepted.runId,
          commitSha,
        }),
      ).resolves.toEqual({
        kind: "applied",
      });

      const rows = await readProjectDoRows(project.id);
      expect(rows.runs[0]?.commitSha).toBe(commitSha);

      const runMeta = await env.RUN_DO.getByName(accepted.runId).getRunSummary(accepted.runId);
      expect(runMeta?.commitSha).toBe(commitSha);

      const db = createD1Db(env.DB);
      const d1Row = await db.select().from(d1Schema.runIndex).where(eq(d1Schema.runIndex.id, accepted.runId)).limit(1);
      expect(d1Row[0]?.commitSha).toBe(commitSha);
    });

    it("keeps resolved-commit backfill non-fatal when RunDO fan-out fails and repairs it on retry", async () => {
      const user = await seedUser({
        email: "commit-backfill-retry@example.com",
        slug: "commit-backfill-retry-user",
      });
      const project = await seedProject(user, {
        projectSlug: "commit-backfill-retry-project",
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

      const commitSha = CommitSha.assertDecode("89abcdef0123456789abcdef0123456789abcdef");
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

      const rows = await readProjectDoRows(project.id);
      expect(rows.runs[0]?.commitSha).toBe(commitSha);
      expect(rows.runs[0]?.d1SyncStatus).toBe("needs_update");

      const staleRunMeta = await env.RUN_DO.getByName(accepted.runId).getRunSummary(accepted.runId);
      expect(staleRunMeta?.commitSha).toBeNull();

      const staleDb = createD1Db(env.DB);
      const staleD1Row = await staleDb
        .select()
        .from(d1Schema.runIndex)
        .where(eq(d1Schema.runIndex.id, accepted.runId))
        .limit(1);
      expect(staleD1Row[0]).toMatchObject({
        commitSha,
        status: "queued",
        startedAt: null,
        finishedAt: null,
        exitCode: null,
      });

      await runInDurableObject(projectStub, async (instance: ProjectDO) => {
        const context = createTestProjectDoContext(instance);

        await sidecarState.setD1RetryState(context, accepted.runId, null);
        await reconcileRunMetadataD1Sync(context, project.id);
      });

      const repairedRows = await readProjectDoRows(project.id);
      expect(repairedRows.runs[0]?.commitSha).toBe(commitSha);
      expect(repairedRows.runs[0]?.d1SyncStatus).toBe("current");

      const repairedRunMeta = await env.RUN_DO.getByName(accepted.runId).getRunSummary(accepted.runId);
      expect(repairedRunMeta?.commitSha).toBe(commitSha);

      const repairedDb = createD1Db(env.DB);
      const repairedD1Row = await repairedDb
        .select()
        .from(d1Schema.runIndex)
        .where(eq(d1Schema.runIndex.id, accepted.runId))
        .limit(1);
      expect(repairedD1Row[0]?.commitSha).toBe(commitSha);
    });
  });

  describe("initial create synchronization", () => {
    it("creates the initial D1 row even when RunDO is unavailable during create sync", async () => {
      const user = await seedUser({
        email: "create-sync-rundo-unavailable@example.com",
        slug: "create-sync-rundo-unavailable-user",
      });
      const project = await seedProject(user, {
        projectSlug: "create-sync-rundo-unavailable-project",
      });
      const projectStub = env.PROJECT_DO.getByName(project.id);

      const accepted = await acceptManualRunWithoutAlarm(projectStub, {
        projectId: project.id,
        triggeredByUserId: user.id,
        branch: project.defaultBranch,
      });

      await runInDurableObject(projectStub, async (instance: ProjectDO) => {
        const baseContext = createTestProjectDoContext(instance);
        const failingEnv = Object.assign(Object.create(baseContext.env), {
          RUN_DO: Object.assign(Object.create(baseContext.env.RUN_DO), {
            getByName: () => {
              throw new Error("RunDO unavailable during create sync");
            },
          }),
        }) as Env;
        const context = createTestProjectDoContext(instance, failingEnv);

        await expect(reconcileAcceptedRunD1Sync(context, project.id)).resolves.toBe(accepted.runId);
      });

      const rows = await readProjectDoRows(project.id);
      expect(rows.runs[0]?.d1SyncStatus).toBe("current");

      const db = createD1Db(env.DB);
      const d1Row = await db.select().from(d1Schema.runIndex).where(eq(d1Schema.runIndex.id, accepted.runId)).limit(1);
      expect(d1Row[0]).toMatchObject({
        status: "queued",
        commitSha: null,
        startedAt: null,
        finishedAt: null,
        exitCode: null,
      });
    });

    it("does not let create sync overwrite fresher resolved-commit metadata", async () => {
      const user = await seedUser({
        email: "create-sync-race@example.com",
        slug: "create-sync-race-user",
      });
      const project = await seedProject(user, {
        projectSlug: "create-sync-race-project",
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
      if (claim.kind !== "execute") {
        throw new Error("Expected claimRunWork to return an executable snapshot.");
      }

      const runStub = env.RUN_DO.getByName(accepted.runId);
      await runStub.ensureInitialized(claim.snapshot);
      await runStub.updateRunState({
        runId: accepted.runId,
        status: "starting",
        currentStep: null,
        startedAt: accepted.queuedAt,
        finishedAt: null,
        exitCode: null,
        errorMessage: null,
      });

      const commitSha = CommitSha.assertDecode("fedcba9876543210fedcba9876543210fedcba98");
      let injectedResolvedCommitSync = false;

      await runInDurableObject(projectStub, async (instance: ProjectDO) => {
        const baseContext = createTestProjectDoContext(instance);
        const originalUpsertRunIndex = d1Repositories.upsertRunIndex;
        const upsertSpy = vi
          .spyOn(d1Repositories, "upsertRunIndex")
          .mockImplementation(async (...args: Parameters<typeof d1Repositories.upsertRunIndex>) => {
            const [, row] = args;

            if (!injectedResolvedCommitSync && row.id === accepted.runId) {
              injectedResolvedCommitSync = true;
              await recordRunResolvedCommitCommand(baseContext, {
                projectId: project.id,
                runId: accepted.runId,
                commitSha,
              });
            }

            return await originalUpsertRunIndex(...args);
          });

        try {
          await expect(reconcileAcceptedRunD1Sync(baseContext, project.id)).resolves.toBe(accepted.runId);
        } finally {
          upsertSpy.mockRestore();
        }
      });

      const rows = await readProjectDoRows(project.id);
      expect(rows.runs[0]?.commitSha).toBe(commitSha);
      expect(rows.runs[0]?.d1SyncStatus).toBe("current");

      const runMeta = await runStub.getRunSummary(accepted.runId);
      expect(runMeta).toMatchObject({
        commitSha,
        status: "starting",
        startedAt: accepted.queuedAt,
      });

      const db = createD1Db(env.DB);
      const d1Row = await db.select().from(d1Schema.runIndex).where(eq(d1Schema.runIndex.id, accepted.runId)).limit(1);
      expect(d1Row[0]).toMatchObject({
        commitSha,
        status: "queued",
        startedAt: null,
        finishedAt: null,
        exitCode: null,
      });
    });
  });

  describe("terminal synchronization guards", () => {
    it("does not publish terminal D1 state before ProjectDO finalizes the run", async () => {
      const user = await seedUser({
        email: "terminal-before-finalize@example.com",
        slug: "terminal-before-finalize-user",
      });
      const project = await seedProject(user, {
        projectSlug: "terminal-before-finalize-project",
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
      if (claim.kind !== "execute") {
        throw new Error("Expected claimRunWork to return an executable snapshot.");
      }

      const runStub = env.RUN_DO.getByName(accepted.runId);
      const finishedAt = expectTrusted(UnixTimestampMs, accepted.queuedAt + 5_000, "UnixTimestampMs");

      await runStub.ensureInitialized(claim.snapshot);
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
      await runStub.updateRunState({
        runId: accepted.runId,
        status: "failed",
        currentStep: null,
        startedAt: accepted.queuedAt,
        finishedAt,
        exitCode: 1,
        errorMessage: "checkout_failed",
      });

      await runInDurableObject(projectStub, async (instance: ProjectDO) => {
        const context = createTestProjectDoContext(instance);

        await expect(reconcileAcceptedRunD1Sync(context, project.id)).resolves.toBe(accepted.runId);
      });

      const preFinalizeRows = await readProjectDoRows(project.id);
      expect(preFinalizeRows.state?.activeRunId).toBe(accepted.runId);
      expect(preFinalizeRows.runs[0]?.status).toBe("active");
      expect(preFinalizeRows.runs[0]?.d1SyncStatus).toBe("current");

      const db = createD1Db(env.DB);
      const staleD1Row = await db
        .select()
        .from(d1Schema.runIndex)
        .where(eq(d1Schema.runIndex.id, accepted.runId))
        .limit(1);
      expect(staleD1Row[0]).toMatchObject({
        status: "queued",
        startedAt: null,
        finishedAt: null,
        exitCode: null,
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

        await expect(reconcileTerminalRunD1Sync(context, project.id)).resolves.toBe(accepted.runId);
      });

      const finalizedRows = await readProjectDoRows(project.id);
      expect(finalizedRows.state?.activeRunId).toBeNull();
      expect(finalizedRows.runs[0]?.status).toBe("failed");
      expect(finalizedRows.runs[0]?.d1SyncStatus).toBe("done");

      const terminalD1Row = await db
        .select()
        .from(d1Schema.runIndex)
        .where(eq(d1Schema.runIndex.id, accepted.runId))
        .limit(1);
      expect(terminalD1Row[0]).toMatchObject({
        status: "failed",
        startedAt: accepted.queuedAt,
        finishedAt,
        exitCode: 1,
      });
    });

    it("does not let resolved-commit metadata sync regress an already-terminal D1 row", async () => {
      const user = await seedUser({
        email: "commit-backfill-terminal@example.com",
        slug: "commit-backfill-terminal-user",
      });
      const project = await seedProject(user, {
        projectSlug: "commit-backfill-terminal-project",
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

      await env.RUN_DO.getByName(accepted.runId).updateRunState({
        runId: accepted.runId,
        status: "starting",
        currentStep: null,
        startedAt: accepted.queuedAt,
        finishedAt: null,
        exitCode: null,
        errorMessage: null,
      });

      const commitSha = CommitSha.assertDecode("76543210fedcba9876543210fedcba9876543210");
      const finishedAt = accepted.queuedAt + 1;
      let injectedTerminalState = false;

      await runInDurableObject(projectStub, async (instance: ProjectDO) => {
        const baseContext = createTestProjectDoContext(instance);
        const originalUpsertRunIndex = d1Repositories.upsertRunIndex;
        const upsertSpy = vi
          .spyOn(d1Repositories, "upsertRunIndex")
          .mockImplementation(async (...args: Parameters<typeof d1Repositories.upsertRunIndex>) => {
            const [, row] = args;

            if (!injectedTerminalState && row.id === accepted.runId) {
              injectedTerminalState = true;
              await baseContext.db
                .update(projectDoSchema.projectRuns)
                .set({
                  status: "failed",
                  position: null,
                  dispatchStatus: "terminal",
                  d1SyncStatus: "done",
                  lastError: "runner_lost",
                })
                .where(eq(projectDoSchema.projectRuns.runId, accepted.runId));
              await baseContext.db
                .update(projectDoSchema.projectState)
                .set({
                  activeRunId: null,
                  updatedAt: finishedAt,
                })
                .where(eq(projectDoSchema.projectState.projectId, project.id));

              const db = createD1Db(baseContext.env.DB);
              await db
                .update(d1Schema.runIndex)
                .set({
                  status: "failed",
                  startedAt: accepted.queuedAt,
                  finishedAt,
                  exitCode: 1,
                })
                .where(eq(d1Schema.runIndex.id, accepted.runId));
            }

            return await originalUpsertRunIndex(...args);
          });

        try {
          await expect(
            recordRunResolvedCommitCommand(baseContext, {
              projectId: project.id,
              runId: accepted.runId,
              commitSha,
            }),
          ).resolves.toEqual({
            kind: "applied",
          });
        } finally {
          upsertSpy.mockRestore();
        }
      });

      const db = createD1Db(env.DB);
      const d1Row = await db.select().from(d1Schema.runIndex).where(eq(d1Schema.runIndex.id, accepted.runId)).limit(1);
      expect(d1Row[0]).toMatchObject({
        commitSha,
        status: "failed",
        startedAt: accepted.queuedAt,
        finishedAt,
        exitCode: 1,
      });

      const rows = await readProjectDoRows(project.id);
      expect(rows.runs[0]?.status).toBe("failed");
      expect(rows.runs[0]?.d1SyncStatus).toBe("done");
    });
  });
});
