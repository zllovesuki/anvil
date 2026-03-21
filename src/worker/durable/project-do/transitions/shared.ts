import { and, asc, eq } from "drizzle-orm";

import {
  BranchName,
  CommitSha,
  DispatchMode,
  ExecutionRuntime,
  ProjectId,
  RunId,
  TriggerType,
  UnixTimestampMs,
  UserId,
} from "@/contracts";
import { D1SyncStatus, isTerminalStatus, nullableTrusted, expectTrusted } from "@/worker/contracts";
import * as projectSchema from "@/worker/db/durable/schema/project-do";

import { getProjectStateRow } from "../repo";
import type { ProjectDoContext, ProjectRunRow, ProjectStore } from "../types";

export const ensureProjectState = (context: ProjectDoContext, tx: ProjectStore, projectId: ProjectId): void => {
  context.cacheProjectId(projectId);
  tx.insert(projectSchema.projectState)
    .values({
      projectId,
      activeRunId: null,
      projectIndexSyncStatus: "current",
      updatedAt: Date.now(),
    })
    .onConflictDoNothing()
    .run();
};

export const getSnapshot = (row: ProjectRunRow) => ({
  runId: expectTrusted(RunId, row.runId, "RunId"),
  projectId: expectTrusted(ProjectId, row.projectId, "ProjectId"),
  triggerType: expectTrusted(TriggerType, row.triggerType, "TriggerType"),
  triggeredByUserId: nullableTrusted(UserId, row.triggeredByUserId, "UserId"),
  branch: expectTrusted(BranchName, row.branch, "BranchName"),
  commitSha: nullableTrusted(CommitSha, row.commitSha, "CommitSha"),
  repoUrl: row.repoUrl,
  configPath: row.configPath,
  dispatchMode: expectTrusted(DispatchMode, row.dispatchMode, "DispatchMode"),
  executionRuntime: expectTrusted(ExecutionRuntime, row.executionRuntime, "ExecutionRuntime"),
  queuedAt: expectTrusted(UnixTimestampMs, row.createdAt, "UnixTimestampMs"),
});

export { isTerminalStatus } from "@/worker/contracts";

export const nextTerminalD1SyncStatus = (current: D1SyncStatus): D1SyncStatus => {
  if (current === "done") {
    return "done";
  }

  return current === "needs_create" ? "needs_create" : "needs_terminal_update";
};

export const nextMetadataD1SyncStatus = (current: D1SyncStatus): D1SyncStatus => {
  if (current === "done" || current === "needs_terminal_update") {
    return current;
  }

  return "needs_update";
};

export const promoteNextPendingRun = (tx: ProjectStore, projectId: ProjectId): RunId | null => {
  const stateRow = getProjectStateRow(tx, projectId);
  if (stateRow?.activeRunId) {
    return null;
  }

  const existingExecutable = tx
    .select({ runId: projectSchema.projectRuns.runId })
    .from(projectSchema.projectRuns)
    .where(and(eq(projectSchema.projectRuns.projectId, projectId), eq(projectSchema.projectRuns.status, "executable")))
    .limit(1)
    .get();
  if (existingExecutable) {
    return null;
  }

  const nextRow = tx
    .select({ runId: projectSchema.projectRuns.runId })
    .from(projectSchema.projectRuns)
    .where(and(eq(projectSchema.projectRuns.projectId, projectId), eq(projectSchema.projectRuns.status, "pending")))
    .orderBy(asc(projectSchema.projectRuns.position))
    .limit(1)
    .get();
  if (!nextRow) {
    return null;
  }

  tx.update(projectSchema.projectRuns)
    .set({
      status: "executable",
      dispatchStatus: "pending",
    })
    .where(eq(projectSchema.projectRuns.runId, nextRow.runId))
    .run();

  return expectTrusted(RunId, nextRow.runId, "RunId");
};
