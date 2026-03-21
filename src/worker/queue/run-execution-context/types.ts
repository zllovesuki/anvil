import { eg, type TypeFromCodec } from "@cloudflare/util-en-garde";
import type { ExecutionSession, Process, Sandbox } from "@cloudflare/sandbox";

import { type ProjectId, type RunId, type UnixTimestampMs } from "@/contracts";
import {
  type AcceptedRunSnapshot,
  type AppendRunLogsInput,
  type ExecuteRunWork,
  type FinalizeRunExecutionResult,
  type PositiveInteger,
  ProjectRunStatus,
  type RecordRunResolvedCommitInput,
  type RecordRunResolvedCommitResult,
  type ReplaceRunStepsInput,
  type RepoConfig,
  type RunHeartbeatResult,
  type RunMetaState,
  type UpdateRunStateInput,
  type UpdateRunStepStateInput,
} from "@/worker/contracts";
import type { ProjectDO, RunDO } from "@/worker/durable";
import type { ProjectExecutionMaterial } from "@/worker/durable/project-do/types";
import type { TryUpdateRunStateResult } from "@/worker/durable/run-do/repo/core";

const NullableNumber = eg.union([eg.number, eg.null]);

export const RunExecutionPhase = eg.union([
  eg.literal("booting"),
  eg.literal("checking_out"),
  eg.literal("running_step"),
  eg.literal("canceling"),
  eg.literal("cleaning_up"),
  eg.literal("finalizing"),
]);
export type RunExecutionPhase = TypeFromCodec<typeof RunExecutionPhase>;

export const RunExecutionOutcome = eg.union([
  eg.exactStrict(
    eg.object({
      kind: eg.literal("passed"),
      exitCode: NullableNumber,
    }),
  ),
  eg.exactStrict(
    eg.object({
      kind: eg.literal("failed"),
      exitCode: NullableNumber,
      errorMessage: eg.string,
    }),
  ),
  eg.exactStrict(
    eg.object({
      kind: eg.literal("canceled"),
    }),
  ),
  eg.exactStrict(
    eg.object({
      kind: eg.literal("ownership_lost"),
      observedStatus: eg.union([ProjectRunStatus, eg.null]),
    }),
  ),
]);
export type RunExecutionOutcome = TypeFromCodec<typeof RunExecutionOutcome>;

export interface PreparedExecutionEnvironment {
  readonly repoConfig: RepoConfig;
  readonly workingDirectory: string;
}

export interface RunExecutionLogContext {
  readonly projectId: ProjectId;
  readonly runId: RunId;
}

export interface RunExecutionScope {
  readonly env: Env;
  readonly executionMaterial: ProjectExecutionMaterial;
  readonly claim: ExecuteRunWork;
  readonly snapshot: AcceptedRunSnapshot;
  readonly projectId: ProjectId;
  readonly runId: RunId;
  readonly repoRoot: string;
  readonly startedAt: UnixTimestampMs;
  readonly logContext: RunExecutionLogContext;
}

export interface RunExecutionContextState {
  phase: RunExecutionPhase;
  session: ExecutionSession | null;
  currentProcess: Process | null;
  currentStepPosition: PositiveInteger | null;
  cancelRequestedAt: UnixTimestampMs | null;
  preservedTerminalStatus: Extract<RunMetaState["status"], "passed" | "failed"> | null;
  ownershipLost: boolean;
  ownershipLossStatus: ProjectRunStatus | null;
  softCancelIssued: boolean;
  hardCancelIssued: boolean;
  redactionSecrets: string[];
}

export type RunStateUpdateOverrides = Partial<
  Pick<RunMetaState, "currentStep" | "startedAt" | "finishedAt" | "exitCode" | "errorMessage">
>;

export interface RunStore {
  getFreshStub(): DurableObjectStub<RunDO>;
  getMeta(): Promise<RunMetaState>;
  updateState(input: Omit<UpdateRunStateInput, "runId">): Promise<void>;
  tryUpdateState(input: Omit<UpdateRunStateInput, "runId">): Promise<TryUpdateRunStateResult>;
  repairTerminalState(input: Omit<UpdateRunStateInput, "runId">): Promise<void>;
  replaceSteps(input: Omit<ReplaceRunStepsInput, "runId">): Promise<void>;
  updateStepState(input: Omit<UpdateRunStepStateInput, "runId">): Promise<void>;
  appendLogs(events: AppendRunLogsInput["events"]): Promise<void>;
}

export interface ProjectControl {
  getFreshStub(): DurableObjectStub<ProjectDO>;
  recordHeartbeat(): Promise<RunHeartbeatResult>;
  recordResolvedCommit(commitSha: RecordRunResolvedCommitInput["commitSha"]): Promise<RecordRunResolvedCommitResult>;
  finalizeRunExecution(
    terminalStatus: Extract<RunMetaState["status"], "passed" | "failed" | "canceled">,
    lastError: string | null,
    sandboxDestroyed: boolean,
  ): Promise<FinalizeRunExecutionResult>;
  kickReconciliation(trigger: string): Promise<void>;
}

export interface RunLogs {
  appendSystemLog(message: string): Promise<void>;
  redactMessage(message: string): string;
}

export interface RunRuntime {
  readonly sandbox: Sandbox;
  getLiveCurrentProcess(): Process | null;
  isProcessTreeAlive(session: ExecutionSession): Promise<boolean>;
  softCancelProcessTree(session: ExecutionSession, process: Process | null): Promise<void>;
  hardCancelProcessTree(session: ExecutionSession, process: Process | null): Promise<void>;
  waitForProcessTreeToStop(session: ExecutionSession, timeoutMs: number, pollIntervalMs?: number): Promise<boolean>;
  waitForProcessTreeToStopSafely(session: ExecutionSession, timeoutMs: number, cleanupPhase: string): Promise<boolean>;
  destroySandbox(): Promise<boolean>;
}

export interface RunControl {
  getRunMeta(): Promise<RunMetaState>;
  updateRunFromCurrent(
    current: RunMetaState,
    status: UpdateRunStateInput["status"],
    overrides?: RunStateUpdateOverrides,
  ): Promise<RunMetaState>;
  preserveTerminalOutcome(outcome: Exclude<RunExecutionOutcome, { kind: "ownership_lost" | "canceled" }>): void;
  ensureRunCancelRequested(): Promise<RunMetaState | null>;
  ensureRunCanceling(): Promise<RunMetaState | null>;
  markOwnershipLost(status: ProjectRunStatus | null): void;
}

export interface RunExecutionContext {
  readonly scope: RunExecutionScope;
  readonly state: RunExecutionContextState;
  readonly runStore: RunStore;
  readonly projectControl: ProjectControl;
  readonly runtime: RunRuntime;
  readonly logs: RunLogs;
  readonly control: RunControl;
}
