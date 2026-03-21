import { eq } from "drizzle-orm";

import { type ProjectId, RunId } from "@/contracts";
import { D1SyncStatus, expectTrusted } from "@/worker/contracts";
import { createD1Db } from "@/worker/db/d1";
import { updateProjectIndexReplicaById, upsertRunIndex } from "@/worker/db/d1/repositories";
import * as projectSchema from "@/worker/db/durable/schema/project-do";

import { D1_RETRY_DELAYS_MS } from "../constants";
import { getOldestRunByD1SyncStatus, getProjectConfig, getProjectState, getRunRowByRunId } from "../repo";
import { ensureRunInitialized, setRunDoTerminal } from "../run-do-sync";
import {
  getD1RetryState,
  getProjectIndexRetryState,
  setD1RetryState,
  setProjectIndexRetryState,
  shouldWaitForD1Retry,
} from "../sidecar-state";
import {
  buildLatestQueuedRunIndexTruth,
  getNextD1RetryAttempt,
  getRetryDelay,
  getRunStub,
  resolvePostQueuedSyncD1Status,
  type ProjectRunTableRow,
} from "./shared";
import { isTerminalStatus } from "../transitions/shared";
import type { ProjectDoContext } from "../types";

const getNextProjectIndexRetryAttempt = (retryState: Awaited<ReturnType<typeof getProjectIndexRetryState>>): number =>
  retryState ? retryState.attempt + 1 : 1;

export const reconcileProjectIndexReplicaSync = async (
  context: ProjectDoContext,
  projectId: ProjectId,
): Promise<ProjectId | null> => {
  const stateRow = await getProjectState(context, projectId);
  if (!stateRow || stateRow.projectIndexSyncStatus !== "needs_update") {
    return null;
  }

  const retryState = await getProjectIndexRetryState(context);
  if (retryState && retryState.nextAt > Date.now()) {
    return null;
  }

  try {
    const configRow = await getProjectConfig(context, projectId);
    if (!configRow) {
      throw new Error(`Project config ${projectId} is missing during read replica sync.`);
    }

    const db = createD1Db(context.env.DB.withSession("first-primary"));
    const updated = await updateProjectIndexReplicaById(db, projectId, {
      name: configRow.name,
      repoUrl: configRow.repoUrl,
      defaultBranch: configRow.defaultBranch,
      configPath: configRow.configPath,
      updatedAt: configRow.updatedAt,
    });
    if (!updated) {
      throw new Error(`Project index ${projectId} is missing during read replica sync.`);
    }

    await context.db
      .update(projectSchema.projectState)
      .set({ projectIndexSyncStatus: "current" })
      .where(eq(projectSchema.projectState.projectId, projectId));
    await setProjectIndexRetryState(context, null);
    return projectId;
  } catch (error) {
    const attempt = getNextProjectIndexRetryAttempt(retryState);
    const nextAt = Date.now() + getRetryDelay(attempt, D1_RETRY_DELAYS_MS);
    await setProjectIndexRetryState(context, {
      attempt,
      nextAt,
      phase: "project_index",
    });
    context.logger.error("project_index_sync_failed", {
      projectId,
      attempt,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
};

export const syncRunMetadataToD1 = async (
  context: ProjectDoContext,
  projectId: ProjectId,
  runId: RunId,
  rowOverride?: ProjectRunTableRow,
): Promise<RunId | null> => {
  const row = rowOverride ?? (await getRunRowByRunId(context, runId));
  if (!row) {
    return null;
  }

  const retryState = await getD1RetryState(context, runId);

  try {
    const truth = await buildLatestQueuedRunIndexTruth(context, runId, row);
    if (!truth) {
      return null;
    }

    const db = createD1Db(context.env.DB.withSession("first-primary"));
    await upsertRunIndex(db, truth.truthRow);

    let latestRow = await getRunRowByRunId(context, runId);
    if (!latestRow) {
      throw new Error(`Run ${runId} disappeared after D1 metadata sync.`);
    }

    const latestD1SyncStatus = expectTrusted(D1SyncStatus, latestRow.d1SyncStatus, "D1SyncStatus");
    let preserveMetadataRetry = false;
    if (latestD1SyncStatus === "needs_update") {
      try {
        await ensureRunInitialized(context, latestRow);
        latestRow = (await getRunRowByRunId(context, runId)) ?? latestRow;
      } catch (error) {
        latestRow = (await getRunRowByRunId(context, runId)) ?? latestRow;
        preserveMetadataRetry = true;

        const attempt = getNextD1RetryAttempt(retryState, "metadata");
        const nextAt = Date.now() + getRetryDelay(attempt, D1_RETRY_DELAYS_MS);
        await setD1RetryState(context, runId, { attempt, nextAt, phase: "metadata" });
        context.logger.error("run_do_metadata_sync_failed", {
          projectId,
          runId,
          attempt,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const nextD1SyncStatus = resolvePostQueuedSyncD1Status(latestRow, truth.truthRow, preserveMetadataRetry);

    await context.db
      .update(projectSchema.projectRuns)
      .set({ d1SyncStatus: nextD1SyncStatus })
      .where(eq(projectSchema.projectRuns.runId, row.runId));

    if (nextD1SyncStatus !== "needs_update") {
      await setD1RetryState(context, runId, null);
    }

    return runId;
  } catch (error) {
    const attempt = getNextD1RetryAttempt(retryState, "metadata");
    const nextAt = Date.now() + getRetryDelay(attempt, D1_RETRY_DELAYS_MS);
    await setD1RetryState(context, runId, { attempt, nextAt, phase: "metadata" });
    context.logger.error("d1_metadata_sync_failed", {
      projectId,
      runId,
      attempt,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
};

export const reconcileAcceptedRunD1Sync = async (
  context: ProjectDoContext,
  projectId: ProjectId,
): Promise<RunId | null> => {
  const row = await getOldestRunByD1SyncStatus(context, projectId, "needs_create");
  if (!row) {
    return null;
  }

  const runId = expectTrusted(RunId, row.runId, "RunId");
  const retryState = await getD1RetryState(context, runId);
  if (shouldWaitForD1Retry(retryState, "create")) {
    return null;
  }

  try {
    const truth = await buildLatestQueuedRunIndexTruth(context, runId, row);
    if (!truth) {
      return null;
    }

    const db = createD1Db(context.env.DB.withSession("first-primary"));
    await upsertRunIndex(db, truth.truthRow);

    const latestRow = await getRunRowByRunId(context, runId);
    if (!latestRow) {
      throw new Error(`Run ${runId} disappeared after D1 create sync.`);
    }

    await context.db
      .update(projectSchema.projectRuns)
      .set({ d1SyncStatus: resolvePostQueuedSyncD1Status(latestRow, truth.truthRow) })
      .where(eq(projectSchema.projectRuns.runId, row.runId));
    await setD1RetryState(context, runId, null);
    return runId;
  } catch (error) {
    const attempt = getNextD1RetryAttempt(retryState, "create");
    const nextAt = Date.now() + getRetryDelay(attempt, D1_RETRY_DELAYS_MS);
    await setD1RetryState(context, runId, { attempt, nextAt, phase: "create" });
    context.logger.error("d1_create_sync_failed", {
      projectId,
      runId,
      attempt,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
};

export const reconcileRunMetadataD1Sync = async (
  context: ProjectDoContext,
  projectId: ProjectId,
): Promise<RunId | null> => {
  const row = await getOldestRunByD1SyncStatus(context, projectId, "needs_update");
  if (!row) {
    return null;
  }

  const runId = expectTrusted(RunId, row.runId, "RunId");
  const retryState = await getD1RetryState(context, runId);
  if (shouldWaitForD1Retry(retryState, "metadata")) {
    return null;
  }

  return await syncRunMetadataToD1(context, projectId, runId, row);
};

export const reconcileTerminalRunD1Sync = async (
  context: ProjectDoContext,
  projectId: ProjectId,
): Promise<RunId | null> => {
  const row = await getOldestRunByD1SyncStatus(context, projectId, "needs_terminal_update");
  if (!row) {
    return null;
  }

  const runId = expectTrusted(RunId, row.runId, "RunId");
  const retryState = await getD1RetryState(context, runId);
  if (shouldWaitForD1Retry(retryState, "terminal")) {
    return null;
  }

  try {
    const runStub = getRunStub(context, runId);
    let runMeta = await runStub.getRunSummary(runId);

    if (
      (!runMeta || !isTerminalStatus(runMeta.status) || runMeta.finishedAt === null) &&
      isTerminalStatus(row.status)
    ) {
      await setRunDoTerminal(context, row, row.status, row.lastError);
      runMeta = await runStub.getRunSummary(runId);
    }

    if (!runMeta || !isTerminalStatus(runMeta.status) || runMeta.finishedAt === null) {
      throw new Error(`Run ${runId} is missing terminal RunDO metadata.`);
    }

    const db = createD1Db(context.env.DB.withSession("first-primary"));
    await upsertRunIndex(db, {
      id: row.runId,
      projectId: row.projectId,
      triggeredByUserId: row.triggeredByUserId,
      triggerType: row.triggerType,
      branch: row.branch,
      commitSha: row.commitSha,
      dispatchMode: row.dispatchMode,
      executionRuntime: row.executionRuntime,
      status: runMeta.status,
      queuedAt: row.createdAt,
      startedAt: runMeta.startedAt,
      finishedAt: runMeta.finishedAt,
      exitCode: runMeta.exitCode,
    });

    await context.db
      .update(projectSchema.projectRuns)
      .set({ d1SyncStatus: "done" })
      .where(eq(projectSchema.projectRuns.runId, row.runId));
    await setD1RetryState(context, runId, null);
    return runId;
  } catch (error) {
    const attempt = getNextD1RetryAttempt(retryState, "terminal");
    const nextAt = Date.now() + getRetryDelay(attempt, D1_RETRY_DELAYS_MS);
    await setD1RetryState(context, runId, { attempt, nextAt, phase: "terminal" });
    context.logger.error("d1_terminal_sync_failed", {
      projectId,
      runId,
      attempt,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
};
