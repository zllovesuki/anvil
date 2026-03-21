import { eg, type TypeFromCodec } from "@cloudflare/util-en-garde";

import { CommitSha, ProjectId, RunId, UnixTimestampMs } from "@/contracts/common";
import { AcceptedRunSnapshot } from "./project-run";
import { ProjectRunStatus, ProjectRunTerminalStatus } from "./primitives";

const NullableTimestamp = eg.union([UnixTimestampMs, eg.null]);

export const ClaimRunWorkInput = eg.exactStrict(
  eg.object({
    projectId: ProjectId,
    runId: RunId,
  }),
);
export type ClaimRunWorkInput = TypeFromCodec<typeof ClaimRunWorkInput>;

export const ClaimRunWorkStaleReason = eg.union([
  eg.literal("run_missing"),
  eg.literal("run_active"),
  eg.literal("canceled"),
  eg.literal("superseded"),
  eg.literal("already_terminal"),
  eg.literal("not_currently_executable"),
]);
export type ClaimRunWorkStaleReason = TypeFromCodec<typeof ClaimRunWorkStaleReason>;

const ExecuteRunWork = eg.exactStrict(
  eg.object({
    kind: eg.literal("execute"),
    snapshot: AcceptedRunSnapshot,
  }),
);

const StaleRunWork = eg.exactStrict(
  eg.object({
    kind: eg.literal("stale"),
    reason: ClaimRunWorkStaleReason,
  }),
);

export const ClaimRunWorkResult = eg.union([ExecuteRunWork, StaleRunWork]);
export type ClaimRunWorkResult = TypeFromCodec<typeof ClaimRunWorkResult>;
export type ExecuteRunWork = Extract<ClaimRunWorkResult, { kind: "execute" }>;

export const RunControlState = eg.exactStrict(
  eg.object({
    runId: RunId,
    status: ProjectRunStatus,
    cancelRequestedAt: NullableTimestamp,
  }),
);
export type RunControlState = TypeFromCodec<typeof RunControlState>;

export const RequestRunCancelInput = eg.exactStrict(
  eg.object({
    projectId: ProjectId,
    runId: RunId,
  }),
);
export type RequestRunCancelInput = TypeFromCodec<typeof RequestRunCancelInput>;

export const RequestRunCancelResult = RunControlState;
export type RequestRunCancelResult = TypeFromCodec<typeof RequestRunCancelResult>;

export const RunHeartbeatInput = eg.exactStrict(
  eg.object({
    projectId: ProjectId,
    runId: RunId,
  }),
);
export type RunHeartbeatInput = TypeFromCodec<typeof RunHeartbeatInput>;

export const RunHeartbeatResult = eg.union([RunControlState, eg.null]);
export type RunHeartbeatResult = TypeFromCodec<typeof RunHeartbeatResult>;

export const FinalizeRunExecutionInput = eg.exactStrict(
  eg.object({
    projectId: ProjectId,
    runId: RunId,
    terminalStatus: ProjectRunTerminalStatus,
    lastError: eg.union([eg.string, eg.null]),
    sandboxDestroyed: eg.boolean,
  }),
);
export type FinalizeRunExecutionInput = TypeFromCodec<typeof FinalizeRunExecutionInput>;

export const FinalizeRunExecutionResult = eg.exactStrict(
  eg.object({
    snapshot: AcceptedRunSnapshot,
  }),
);
export type FinalizeRunExecutionResult = TypeFromCodec<typeof FinalizeRunExecutionResult>;

export const RecordRunResolvedCommitInput = eg.exactStrict(
  eg.object({
    projectId: ProjectId,
    runId: RunId,
    commitSha: CommitSha,
  }),
);
export type RecordRunResolvedCommitInput = TypeFromCodec<typeof RecordRunResolvedCommitInput>;

const RecordRunResolvedCommitAppliedResult = eg.exactStrict(
  eg.object({
    kind: eg.literal("applied"),
  }),
);

const RecordRunResolvedCommitStaleResult = eg.exactStrict(
  eg.object({
    kind: eg.literal("stale"),
    status: eg.union([ProjectRunStatus, eg.null]),
  }),
);

export const RecordRunResolvedCommitResult = eg.union([
  RecordRunResolvedCommitAppliedResult,
  RecordRunResolvedCommitStaleResult,
]);
export type RecordRunResolvedCommitResult = TypeFromCodec<typeof RecordRunResolvedCommitResult>;
