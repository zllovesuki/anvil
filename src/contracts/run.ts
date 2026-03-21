import { eg, type TypeFromCodec } from "@cloudflare/util-en-garde";

import {
  BranchName,
  CommitSha,
  IsoDateTime,
  OpaqueId,
  ProjectId,
  RunId,
  RunStatus,
  TriggerType,
  UserId,
} from "@/contracts/common";
import { StepStatus } from "@/contracts/execution";
import { LogEvent } from "@/contracts/log";

const RunPageLimit = eg.brand(
  "RunPageLimit",
  eg.number,
  (value) => Number.isInteger(value) && value > 0 && value <= 100,
);
const OpaqueCursor = eg.string;

export const TriggerRunRequest = eg.exactStrict(
  eg.object({
    branch: BranchName.optional,
  }),
);
export type TriggerRunRequest = TypeFromCodec<typeof TriggerRunRequest>;

export const TriggerRunAcceptedResponse = eg.exactStrict(
  eg.object({
    runId: RunId,
  }),
);
export type TriggerRunAcceptedResponse = TypeFromCodec<typeof TriggerRunAcceptedResponse>;

export const GetProjectRunsQuery = eg.exactStrict(
  eg.object({
    limit: RunPageLimit.optional,
    cursor: OpaqueCursor.optional,
  }),
);
export type GetProjectRunsQuery = TypeFromCodec<typeof GetProjectRunsQuery>;

export const RunSummary = eg.exactStrict(
  eg.object({
    id: RunId,
    projectId: ProjectId,
    triggeredByUserId: eg.union([UserId, eg.null]),
    triggerType: TriggerType,
    branch: BranchName,
    commitSha: eg.union([CommitSha, eg.null]),
    status: RunStatus,
    queuedAt: IsoDateTime,
    startedAt: eg.union([IsoDateTime, eg.null]),
    finishedAt: eg.union([IsoDateTime, eg.null]),
    exitCode: eg.union([eg.number, eg.null]),
  }),
);
export type RunSummary = TypeFromCodec<typeof RunSummary>;

export const GetProjectRunsResponse = eg.exactStrict(
  eg.object({
    runs: eg.array(RunSummary),
    nextCursor: eg.union([OpaqueCursor, eg.null]),
  }),
);
export type GetProjectRunsResponse = TypeFromCodec<typeof GetProjectRunsResponse>;

export const RunStep = eg.exactStrict(
  eg.object({
    id: OpaqueId,
    runId: RunId,
    position: eg.number,
    name: eg.string,
    command: eg.string,
    status: StepStatus,
    startedAt: eg.union([IsoDateTime, eg.null]),
    finishedAt: eg.union([IsoDateTime, eg.null]),
    exitCode: eg.union([eg.number, eg.null]),
  }),
);
export type RunStep = TypeFromCodec<typeof RunStep>;

export const RunExecutionState = eg.exactStrict(
  eg.object({
    status: RunStatus,
    currentStep: eg.union([eg.number, eg.null]),
    startedAt: eg.union([IsoDateTime, eg.null]),
    finishedAt: eg.union([IsoDateTime, eg.null]),
    exitCode: eg.union([eg.number, eg.null]),
    errorMessage: eg.union([eg.string, eg.null]),
  }),
);
export type RunExecutionState = TypeFromCodec<typeof RunExecutionState>;

export const RunDetail = eg.exactStrict(
  eg.object({
    run: RunSummary,
    currentStep: eg.union([eg.number, eg.null]),
    errorMessage: eg.union([eg.string, eg.null]),
    steps: eg.array(RunStep),
    recentLogs: eg.array(LogEvent),
    detailAvailable: eg.boolean,
  }),
);
export type RunDetail = TypeFromCodec<typeof RunDetail>;

export const LogStreamTicketResponse = eg.exactStrict(
  eg.object({
    ticket: eg.string,
    expiresAt: IsoDateTime,
  }),
);
export type LogStreamTicketResponse = TypeFromCodec<typeof LogStreamTicketResponse>;
