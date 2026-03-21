import { eg, type TypeFromCodec } from "@cloudflare/util-en-garde";

import {
  BranchName,
  CommitSha,
  OpaqueId,
  ProjectId,
  RunId,
  RunStatus,
  TriggerType,
  UnixTimestampMs,
} from "@/contracts/common";
import { LogStream, StepStatus } from "@/contracts/execution/primitives";
import { PositiveInteger } from "./primitives";

const NonNegativeInteger = eg.brand("NonNegativeInteger", eg.number, (value) => Number.isInteger(value) && value >= 0);
const NullableTimestamp = eg.union([UnixTimestampMs, eg.null]);

export const EnsureRunInput = eg.exactStrict(
  eg.object({
    runId: RunId,
    projectId: ProjectId,
    triggerType: TriggerType,
    branch: BranchName,
    commitSha: eg.union([CommitSha, eg.null]),
  }),
);
export type EnsureRunInput = TypeFromCodec<typeof EnsureRunInput>;

export const RunMetaState = eg.exactStrict(
  eg.object({
    runId: RunId,
    projectId: ProjectId,
    status: RunStatus,
    triggerType: TriggerType,
    branch: BranchName,
    commitSha: eg.union([CommitSha, eg.null]),
    currentStep: eg.union([PositiveInteger, eg.null]),
    startedAt: NullableTimestamp,
    finishedAt: NullableTimestamp,
    exitCode: eg.union([eg.number, eg.null]),
    errorMessage: eg.union([eg.string, eg.null]),
  }),
);
export type RunMetaState = TypeFromCodec<typeof RunMetaState>;

export const RunStepInput = eg.exactStrict(
  eg.object({
    position: PositiveInteger,
    name: eg.string,
    command: eg.string,
  }),
);
export type RunStepInput = TypeFromCodec<typeof RunStepInput>;

export const ReplaceRunStepsInput = eg.exactStrict(
  eg.object({
    runId: RunId,
    steps: eg.array(RunStepInput),
  }),
);
export type ReplaceRunStepsInput = TypeFromCodec<typeof ReplaceRunStepsInput>;

export const UpdateRunStateInput = eg.exactStrict(
  eg.object({
    runId: RunId,
    status: RunStatus,
    currentStep: eg.union([PositiveInteger, eg.null]).optional,
    startedAt: NullableTimestamp.optional,
    finishedAt: NullableTimestamp.optional,
    exitCode: eg.union([eg.number, eg.null]).optional,
    errorMessage: eg.union([eg.string, eg.null]).optional,
  }),
);
export type UpdateRunStateInput = TypeFromCodec<typeof UpdateRunStateInput>;

export const UpdateRunStepStateInput = eg.exactStrict(
  eg.object({
    runId: RunId,
    position: PositiveInteger,
    status: StepStatus,
    startedAt: NullableTimestamp.optional,
    finishedAt: NullableTimestamp.optional,
    exitCode: eg.union([eg.number, eg.null]).optional,
  }),
);
export type UpdateRunStepStateInput = TypeFromCodec<typeof UpdateRunStepStateInput>;

export const LogAppendEvent = eg.exactStrict(
  eg.object({
    stream: LogStream,
    chunk: eg.string,
    createdAt: UnixTimestampMs,
  }),
);
export type LogAppendEvent = TypeFromCodec<typeof LogAppendEvent>;

export const AppendRunLogsInput = eg.exactStrict(
  eg.object({
    runId: RunId,
    events: eg.array(LogAppendEvent),
  }),
);
export type AppendRunLogsInput = TypeFromCodec<typeof AppendRunLogsInput>;

export const RunLogRecord = eg.exactStrict(
  eg.object({
    id: OpaqueId,
    runId: RunId,
    seq: PositiveInteger,
    stream: LogStream,
    chunk: eg.string,
    createdAt: UnixTimestampMs,
  }),
);
export type RunLogRecord = TypeFromCodec<typeof RunLogRecord>;

export const RunStepState = eg.exactStrict(
  eg.object({
    id: OpaqueId,
    runId: RunId,
    position: PositiveInteger,
    name: eg.string,
    command: eg.string,
    status: StepStatus,
    startedAt: NullableTimestamp,
    finishedAt: NullableTimestamp,
    exitCode: eg.union([eg.number, eg.null]),
  }),
);
export type RunStepState = TypeFromCodec<typeof RunStepState>;

export const RunDetailState = eg.exactStrict(
  eg.object({
    meta: eg.union([RunMetaState, eg.null]),
    steps: eg.array(RunStepState),
    recentLogs: eg.array(RunLogRecord),
  }),
);
export type RunDetailState = TypeFromCodec<typeof RunDetailState>;

export const RunQueueMessage = eg.exactStrict(
  eg.object({
    projectId: ProjectId,
    runId: RunId,
  }),
);
export type RunQueueMessage = TypeFromCodec<typeof RunQueueMessage>;

export const RunSequence = NonNegativeInteger;
export type RunSequence = TypeFromCodec<typeof RunSequence>;
