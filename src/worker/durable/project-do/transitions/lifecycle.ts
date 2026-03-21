import { eq } from "drizzle-orm";

import { CommitSha, UnixTimestampMs } from "@/contracts";
import {
  D1SyncStatus,
  nullableTrusted,
  type FinalizeRunExecutionInput,
  type FinalizeRunExecutionResult,
  ProjectRunStatus,
  type ProjectRunTerminalStatus,
  type RecordRunResolvedCommitInput,
  type RequestRunCancelInput,
  expectTrusted,
} from "@/worker/contracts";
import * as projectSchema from "@/worker/db/durable/schema/project-do";

import { getRunRow } from "../repo";
import {
  ensureProjectState,
  getSnapshot,
  isTerminalStatus,
  nextMetadataD1SyncStatus,
  nextTerminalD1SyncStatus,
  promoteNextPendingRun,
} from "./shared";
import type { CancelTransitionResult, ProjectDoContext, ProjectRunRow, ProjectStore } from "../types";

const isFinalizeTransitionAllowed = (
  currentStatus: Extract<ProjectRunStatus, "active" | "cancel_requested">,
  terminalStatus: ProjectRunTerminalStatus,
): boolean =>
  currentStatus === "active"
    ? terminalStatus === "passed" || terminalStatus === "failed"
    : terminalStatus === "canceled" || terminalStatus === "failed";

export const transitionFinalizeRunExecution = (
  context: ProjectDoContext,
  tx: ProjectStore,
  input: FinalizeRunExecutionInput,
): FinalizeRunExecutionResult => {
  ensureProjectState(context, tx, input.projectId);

  const row = getRunRow(tx, input.projectId, input.runId);
  if (!row) {
    throw new Error(`Run ${input.runId} was not found in project state.`);
  }

  const currentStatus = expectTrusted(ProjectRunStatus, row.status, "ProjectRunStatus");

  if (currentStatus === "active" || currentStatus === "cancel_requested") {
    if (!isFinalizeTransitionAllowed(currentStatus, input.terminalStatus)) {
      throw new Error(`Run ${input.runId} cannot transition from ${currentStatus} to ${input.terminalStatus}.`);
    }

    tx.update(projectSchema.projectRuns)
      .set({
        status: input.terminalStatus,
        dispatchStatus: "terminal",
        d1SyncStatus: nextTerminalD1SyncStatus(expectTrusted(D1SyncStatus, row.d1SyncStatus, "D1SyncStatus")),
        lastError: input.lastError,
      })
      .where(eq(projectSchema.projectRuns.runId, input.runId))
      .run();
    tx.update(projectSchema.projectState)
      .set({
        activeRunId: null,
        updatedAt: Date.now(),
      })
      .where(eq(projectSchema.projectState.projectId, input.projectId))
      .run();
    promoteNextPendingRun(tx, input.projectId);
  } else if (isTerminalStatus(currentStatus)) {
    if (currentStatus !== input.terminalStatus) {
      throw new Error(
        `Run ${input.runId} is already terminal in status ${currentStatus}, cannot finalize as ${input.terminalStatus}.`,
      );
    }
  } else {
    throw new Error(`Run ${input.runId} cannot be finalized from status ${currentStatus}.`);
  }

  return {
    snapshot: getSnapshot(row),
  };
};

export type RecordRunResolvedCommitTransition =
  | {
      kind: "applied";
      row: ProjectRunRow;
    }
  | {
      kind: "stale";
      status: ProjectRunStatus | null;
    };

export const transitionRecordRunResolvedCommit = (
  context: ProjectDoContext,
  tx: ProjectStore,
  input: RecordRunResolvedCommitInput,
): RecordRunResolvedCommitTransition => {
  ensureProjectState(context, tx, input.projectId);

  const row = getRunRow(tx, input.projectId, input.runId);
  if (!row) {
    return {
      kind: "stale",
      status: null,
    };
  }

  const currentStatus = expectTrusted(ProjectRunStatus, row.status, "ProjectRunStatus");
  if (currentStatus !== "active" && currentStatus !== "cancel_requested") {
    return {
      kind: "stale",
      status: currentStatus,
    };
  }

  const currentCommitSha = nullableTrusted(CommitSha, row.commitSha, "CommitSha");
  if (currentCommitSha !== null && currentCommitSha !== input.commitSha) {
    throw new Error(`Run ${input.runId} already recorded commit ${currentCommitSha}, cannot replace it.`);
  }

  if (currentCommitSha === input.commitSha) {
    return {
      kind: "applied",
      row,
    };
  }

  const nextD1SyncStatus = nextMetadataD1SyncStatus(expectTrusted(D1SyncStatus, row.d1SyncStatus, "D1SyncStatus"));
  tx.update(projectSchema.projectRuns)
    .set({
      commitSha: input.commitSha,
      d1SyncStatus: nextD1SyncStatus,
    })
    .where(eq(projectSchema.projectRuns.runId, row.runId))
    .run();

  return {
    kind: "applied",
    row: {
      ...row,
      commitSha: input.commitSha,
      d1SyncStatus: nextD1SyncStatus,
    },
  };
};

export const transitionRequestRunCancel = (
  context: ProjectDoContext,
  tx: ProjectStore,
  input: RequestRunCancelInput,
  requestedAt: UnixTimestampMs,
): CancelTransitionResult => {
  ensureProjectState(context, tx, input.projectId);

  const row = getRunRow(tx, input.projectId, input.runId);
  if (!row) {
    throw new Error(`Run ${input.runId} was not found in project state.`);
  }

  if (row.status === "pending" || row.status === "executable") {
    tx.update(projectSchema.projectRuns)
      .set({
        status: "canceled",
        position: null,
        dispatchStatus: "terminal",
        d1SyncStatus: nextTerminalD1SyncStatus(expectTrusted(D1SyncStatus, row.d1SyncStatus, "D1SyncStatus")),
        cancelRequestedAt: requestedAt,
        lastError: null,
      })
      .where(eq(projectSchema.projectRuns.runId, row.runId))
      .run();
    promoteNextPendingRun(tx, input.projectId);

    return {
      row,
      runStatus: "canceled",
      cancelRequestedAt: requestedAt,
      runDoAction: "canceled",
    };
  }

  if (row.status === "active" || row.status === "cancel_requested") {
    const cancelRequestedAt = nullableTrusted(UnixTimestampMs, row.cancelRequestedAt, "UnixTimestampMs") ?? requestedAt;
    tx.update(projectSchema.projectRuns)
      .set({
        status: "cancel_requested",
        cancelRequestedAt,
      })
      .where(eq(projectSchema.projectRuns.runId, row.runId))
      .run();

    return {
      row,
      runStatus: "cancel_requested",
      cancelRequestedAt,
      runDoAction: "cancel_requested",
    };
  }

  return {
    row,
    runStatus: expectTrusted(ProjectRunStatus, row.status, "ProjectRunStatus"),
    cancelRequestedAt: nullableTrusted(UnixTimestampMs, row.cancelRequestedAt, "UnixTimestampMs"),
    runDoAction: "none",
  };
};
