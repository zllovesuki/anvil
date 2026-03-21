import {
  isTerminalStatus,
  type ProjectRunStatus,
  type RunMetaState,
  type UpdateRunStateInput,
} from "@/worker/contracts";
import { RunStateTransitionError } from "@/worker/durable/run-do/state";

import { logger } from "./shared";
import type {
  RunControl,
  RunExecutionContextState,
  RunExecutionOutcome,
  RunExecutionScope,
  RunStateUpdateOverrides,
  RunStore,
} from "./types";

export const updateRunFromCurrent = async (
  scope: RunExecutionScope,
  state: RunExecutionContextState,
  runStore: RunStore,
  current: RunMetaState,
  status: UpdateRunStateInput["status"],
  overrides: RunStateUpdateOverrides = {},
): Promise<RunMetaState> => {
  const hasOverride = <TKey extends keyof typeof overrides>(key: TKey): boolean =>
    Object.prototype.hasOwnProperty.call(overrides, key);

  const result = await runStore.tryUpdateState({
    status,
    currentStep: hasOverride("currentStep") ? overrides.currentStep : current.currentStep,
    startedAt: hasOverride("startedAt") ? overrides.startedAt : current.startedAt,
    finishedAt: hasOverride("finishedAt") ? overrides.finishedAt : current.finishedAt,
    exitCode: hasOverride("exitCode") ? overrides.exitCode : current.exitCode,
    errorMessage: hasOverride("errorMessage") ? overrides.errorMessage : current.errorMessage,
  });

  if (result.kind === "conflict") {
    throw new RunStateTransitionError(result.reason, result.current.status, status);
  }

  return result.state;
};

export const preserveTerminalOutcome = (
  state: RunExecutionContextState,
  outcome: Exclude<RunExecutionOutcome, { kind: "ownership_lost" | "canceled" }>,
): void => {
  if (outcome.kind === "passed" || outcome.kind === "failed") {
    state.preservedTerminalStatus = outcome.kind;
  }
};

export const ensureRunCancelRequested = async (
  scope: RunExecutionScope,
  state: RunExecutionContextState,
  runStore: RunStore,
): Promise<RunMetaState | null> => {
  const current = await runStore.getMeta();
  if (isTerminalStatus(current.status)) {
    return current;
  }

  if (state.preservedTerminalStatus !== null) {
    return current;
  }

  if (current.status === "queued" || current.status === "cancel_requested" || current.status === "canceling") {
    return current;
  }

  return await updateRunFromCurrent(scope, state, runStore, current, "cancel_requested", {
    startedAt: current.startedAt ?? scope.startedAt,
  });
};

export const ensureRunCanceling = async (
  scope: RunExecutionScope,
  state: RunExecutionContextState,
  runStore: RunStore,
): Promise<RunMetaState | null> => {
  const current = await ensureRunCancelRequested(scope, state, runStore);
  if (!current || isTerminalStatus(current.status)) {
    return current;
  }

  if (state.preservedTerminalStatus !== null) {
    return current;
  }

  if (current.status === "canceling" || current.status === "queued") {
    return current;
  }

  if (current.status === "cancel_requested") {
    return await updateRunFromCurrent(scope, state, runStore, current, "canceling", {
      startedAt: current.startedAt ?? scope.startedAt,
    });
  }

  return current;
};

export const markOwnershipLost = (
  scope: RunExecutionScope,
  state: RunExecutionContextState,
  status: ProjectRunStatus | null,
): void => {
  if (state.ownershipLost) {
    return;
  }

  state.ownershipLost = true;
  state.ownershipLossStatus = status;
  logger.warn("run_ownership_lost", {
    ...scope.logContext,
    status,
    phase: state.phase,
  });
};
