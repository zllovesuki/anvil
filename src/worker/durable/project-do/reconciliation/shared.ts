import { type ProjectId, RunId } from "@/contracts";
import { D1SyncStatus, expectTrusted } from "@/worker/contracts";
import { type NewRunIndexRow } from "@/worker/db/d1/repositories";
import * as projectSchema from "@/worker/db/durable/schema/project-do";

import { getRunRowByRunId } from "../repo";
import { ensureProjectState, isTerminalStatus, promoteNextPendingRun } from "../transitions/shared";
import type { D1RetryPhase, D1RetryState, ProjectDoContext } from "../types";

export type ProjectRunTableRow = typeof projectSchema.projectRuns.$inferSelect;

export const getRunStub = (context: ProjectDoContext, runId: RunId) => context.env.RUN_DO.getByName(runId);

export const getRetryDelay = (attempt: number, delays: readonly number[]): number =>
  delays[Math.min(attempt - 1, delays.length - 1)];

export const buildQueuedRunIndexTruthRow = (row: ProjectRunTableRow): NewRunIndexRow => ({
  id: row.runId,
  projectId: row.projectId,
  triggeredByUserId: row.triggeredByUserId,
  triggerType: row.triggerType,
  branch: row.branch,
  commitSha: row.commitSha,
  dispatchMode: row.dispatchMode,
  executionRuntime: row.executionRuntime,
  status: "queued",
  queuedAt: row.createdAt,
  startedAt: null,
  finishedAt: null,
  exitCode: null,
});

export const getNextD1RetryAttempt = (retryState: D1RetryState | null, phase: D1RetryPhase): number => {
  if (!retryState || retryState.phase !== phase) {
    return 1;
  }

  return retryState.attempt + 1;
};

export const resolvePostQueuedSyncD1Status = (
  latestRow: ProjectRunTableRow,
  syncedTruthRow: NewRunIndexRow,
  preserveMetadataRetry = false,
): D1SyncStatus => {
  const latestD1SyncStatus = expectTrusted(D1SyncStatus, latestRow.d1SyncStatus, "D1SyncStatus");

  if (latestD1SyncStatus === "done") {
    return "done";
  }

  if (latestD1SyncStatus === "needs_terminal_update" || isTerminalStatus(latestRow.status)) {
    return "needs_terminal_update";
  }

  if (latestD1SyncStatus === "needs_update") {
    if (preserveMetadataRetry) {
      return "needs_update";
    }

    return latestRow.commitSha === syncedTruthRow.commitSha ? "current" : "needs_update";
  }

  return "current";
};

export const buildLatestQueuedRunIndexTruth = async (
  context: ProjectDoContext,
  runId: RunId,
  rowOverride?: ProjectRunTableRow,
): Promise<{
  latestRow: ProjectRunTableRow;
  truthRow: NewRunIndexRow;
} | null> => {
  const row = rowOverride ?? (await getRunRowByRunId(context, runId));
  if (!row) {
    return null;
  }

  return {
    latestRow: row,
    truthRow: buildQueuedRunIndexTruthRow(row),
  };
};

export const promotePendingRun = (context: ProjectDoContext, projectId: ProjectId): RunId | null =>
  context.db.transaction((tx) => {
    ensureProjectState(context, tx, projectId);
    return promoteNextPendingRun(tx, projectId);
  });
