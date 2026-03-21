import { type DrizzleSqliteDODatabase } from "drizzle-orm/durable-sqlite";

import {
  LogStream,
  OpaqueId,
  ProjectId,
  RunId,
  RunStatus,
  StepStatus,
  TriggerType,
  UnixTimestampMs,
  BranchName,
  CommitSha,
} from "@/contracts";
import {
  expectTrusted,
  nullableTrusted,
  PositiveInteger,
  type RunLogRecord,
  type RunMetaState,
  type RunStepState,
} from "@/worker/contracts";
import * as runSchema from "@/worker/db/durable/schema/run-do";

import type { RunStateTransitionConflictReason } from "../state";

export type RunDb = DrizzleSqliteDODatabase<typeof runSchema>;
export type RunTx = Parameters<RunDb["transaction"]>[0] extends (tx: infer T) => unknown ? T : never;
export type TryUpdateRunStateResult =
  | {
      kind: "applied";
      state: RunMetaState;
    }
  | {
      kind: "conflict";
      reason: RunStateTransitionConflictReason;
      current: RunMetaState;
    };

export const toRunMetaState = (row: typeof runSchema.runMeta.$inferSelect): RunMetaState => ({
  runId: expectTrusted(RunId, row.id, "RunId"),
  projectId: expectTrusted(ProjectId, row.projectId, "ProjectId"),
  status: expectTrusted(RunStatus, row.status, "RunStatus"),
  triggerType: expectTrusted(TriggerType, row.triggerType, "TriggerType"),
  branch: expectTrusted(BranchName, row.branch, "BranchName"),
  commitSha: nullableTrusted(CommitSha, row.commitSha, "CommitSha"),
  currentStep: nullableTrusted(PositiveInteger, row.currentStep, "PositiveInteger"),
  startedAt: nullableTrusted(UnixTimestampMs, row.startedAt, "UnixTimestampMs"),
  finishedAt: nullableTrusted(UnixTimestampMs, row.finishedAt, "UnixTimestampMs"),
  exitCode: row.exitCode,
  errorMessage: row.errorMessage,
});

export const toRunStepState = (row: typeof runSchema.runSteps.$inferSelect): RunStepState => ({
  id: expectTrusted(OpaqueId, row.id, "OpaqueId"),
  runId: expectTrusted(RunId, row.runId, "RunId"),
  position: expectTrusted(PositiveInteger, row.position, "PositiveInteger"),
  name: row.name,
  command: row.command,
  status: expectTrusted(StepStatus, row.status, "StepStatus"),
  startedAt: nullableTrusted(UnixTimestampMs, row.startedAt, "UnixTimestampMs"),
  finishedAt: nullableTrusted(UnixTimestampMs, row.finishedAt, "UnixTimestampMs"),
  exitCode: row.exitCode,
});

export const toRunLogRecord = (row: typeof runSchema.runLogs.$inferSelect): RunLogRecord => ({
  id: expectTrusted(OpaqueId, row.id, "OpaqueId"),
  runId: expectTrusted(RunId, row.runId, "RunId"),
  seq: expectTrusted(PositiveInteger, row.seq, "PositiveInteger"),
  stream: expectTrusted(LogStream, row.stream, "LogStream"),
  chunk: row.chunk,
  createdAt: expectTrusted(UnixTimestampMs, row.createdAt, "UnixTimestampMs"),
});

export const chunkRows = <TRow>(rows: readonly TRow[], maxRowsPerChunk: number): TRow[][] => {
  const chunks: TRow[][] = [];

  for (let index = 0; index < rows.length; index += maxRowsPerChunk) {
    chunks.push(rows.slice(index, index + maxRowsPerChunk));
  }

  return chunks;
};
