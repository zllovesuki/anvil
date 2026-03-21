import { eg, type TypeFromCodec } from "@cloudflare/util-en-garde";

import {
  BranchName,
  CommitSha,
  ProjectId,
  RunId,
  TriggerType,
  UnixTimestampMs,
  UserId,
  WebhookProvider,
} from "@/contracts/common";
import { DispatchMode, ExecutionRuntime } from "@/contracts/execution/dispatch";

export const AcceptedRunSnapshot = eg.exactStrict(
  eg.object({
    runId: RunId,
    projectId: ProjectId,
    triggerType: TriggerType,
    triggeredByUserId: eg.union([UserId, eg.null]),
    branch: BranchName,
    commitSha: eg.union([CommitSha, eg.null]),
    repoUrl: eg.string,
    configPath: eg.string,
    dispatchMode: DispatchMode,
    executionRuntime: ExecutionRuntime,
    queuedAt: UnixTimestampMs,
  }),
);
export type AcceptedRunSnapshot = TypeFromCodec<typeof AcceptedRunSnapshot>;

export const AcceptQueuedRunInput = eg.exactStrict(
  eg.object({
    projectId: ProjectId,
    triggerType: TriggerType,
    triggeredByUserId: eg.union([UserId, eg.null]),
    branch: BranchName,
    commitSha: eg.union([CommitSha, eg.null]),
    repoUrl: eg.string,
    configPath: eg.string,
    provider: eg.union([WebhookProvider, eg.null]),
    deliveryId: eg.union([eg.string, eg.null]),
    dispatchMode: DispatchMode,
    executionRuntime: ExecutionRuntime,
  }),
);
export type AcceptQueuedRunInput = TypeFromCodec<typeof AcceptQueuedRunInput>;

export const AcceptManualRunInput = eg.exactStrict(
  eg.object({
    projectId: ProjectId,
    triggeredByUserId: UserId,
    branch: eg.union([BranchName, eg.null]),
  }),
);
export type AcceptManualRunInput = TypeFromCodec<typeof AcceptManualRunInput>;

export const AcceptedRunResult = eg.exactStrict(
  eg.object({
    runId: RunId,
    queuedAt: UnixTimestampMs,
    executable: eg.boolean,
  }),
);
export type AcceptedRunResult = TypeFromCodec<typeof AcceptedRunResult>;

export const AcceptManualRunResult = eg.union([
  eg.exactStrict(
    eg.object({
      kind: eg.literal("accepted"),
      runId: RunId,
      queuedAt: UnixTimestampMs,
      executable: eg.boolean,
    }),
  ),
  eg.exactStrict(
    eg.object({
      kind: eg.literal("rejected"),
      reason: eg.literal("queue_full"),
    }),
  ),
]);
export type AcceptManualRunResult = TypeFromCodec<typeof AcceptManualRunResult>;

export const PendingRunState = eg.exactStrict(
  eg.object({
    runId: RunId,
    branch: BranchName,
    queuedAt: UnixTimestampMs,
  }),
);
export type PendingRunState = TypeFromCodec<typeof PendingRunState>;

export const ProjectDetailState = eg.exactStrict(
  eg.object({
    activeRunId: eg.union([RunId, eg.null]),
    pendingRuns: eg.array(PendingRunState),
  }),
);
export type ProjectDetailState = TypeFromCodec<typeof ProjectDetailState>;
