import { type RunStatus, type StepStatus } from "@/contracts";
import { isTerminalStatus, type RunMetaState, type UpdateRunStateInput } from "@/worker/contracts";

export type RunStateTransitionConflictReason = "already_terminal" | "invalid_transition";

export class RunStateTransitionError extends Error {
  readonly reason: RunStateTransitionConflictReason;
  readonly current: RunStatus;
  readonly next: RunStatus;

  constructor(reason: RunStateTransitionConflictReason, current: RunStatus, next: RunStatus) {
    super(
      reason === "already_terminal"
        ? `Run is already terminal in status ${current}.`
        : `Invalid run status transition ${current} -> ${next}.`,
    );

    this.name = "RunStateTransitionError";
    this.reason = reason;
    this.current = current;
    this.next = next;
  }
}

export const RUN_TRANSITIONS: Record<RunStatus, RunStatus[]> = {
  queued: ["starting", "failed", "canceled"],
  starting: ["running", "failed", "cancel_requested"],
  running: ["passed", "failed", "cancel_requested"],
  cancel_requested: ["canceling", "canceled"],
  canceling: ["canceled", "failed"],
  passed: [],
  failed: [],
  canceled: [],
};

export const STEP_TRANSITIONS: Record<StepStatus, StepStatus[]> = {
  queued: ["running", "failed"],
  running: ["passed", "failed"],
  passed: [],
  failed: [],
};

export interface ResolvedRunStateUpdate {
  status: RunStatus;
  currentStep: UpdateRunStateInput["currentStep"];
  startedAt: RunMetaState["startedAt"];
  finishedAt: RunMetaState["finishedAt"];
  exitCode: UpdateRunStateInput["exitCode"];
  errorMessage: UpdateRunStateInput["errorMessage"];
}

export const assertRunTransition = (current: RunStatus, next: RunStatus): void => {
  if (current === next) {
    if (isTerminalStatus(current)) {
      throw new RunStateTransitionError("already_terminal", current, next);
    }

    return;
  }

  if (!RUN_TRANSITIONS[current].includes(next)) {
    throw new RunStateTransitionError("invalid_transition", current, next);
  }
};

export const assertStepTransition = (current: StepStatus, next: StepStatus): void => {
  if (current === next) {
    if (current === "passed" || current === "failed") {
      throw new Error(`Step is already terminal in status ${current}.`);
    }

    return;
  }

  if (!STEP_TRANSITIONS[current].includes(next)) {
    throw new Error(`Invalid step status transition ${current} -> ${next}.`);
  }
};

export const resolveRunStateUpdate = (current: RunMetaState, payload: UpdateRunStateInput): ResolvedRunStateUpdate => {
  assertRunTransition(current.status, payload.status);

  const startedAt = payload.startedAt ?? current.startedAt;
  const requiresStartedAt =
    payload.status === "starting" ||
    payload.status === "running" ||
    payload.status === "cancel_requested" ||
    payload.status === "canceling" ||
    payload.status === "passed";
  if (requiresStartedAt && startedAt === null) {
    throw new Error(`Run ${payload.runId} cannot enter ${payload.status} without startedAt.`);
  }

  const finishedAt = payload.finishedAt ?? current.finishedAt;
  if (isTerminalStatus(payload.status) && finishedAt === null) {
    throw new Error(`Run ${payload.runId} cannot enter terminal state ${payload.status} without finishedAt.`);
  }

  return {
    status: payload.status,
    currentStep: payload.currentStep,
    startedAt,
    finishedAt,
    exitCode: payload.exitCode,
    errorMessage: payload.errorMessage,
  };
};
