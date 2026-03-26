import type { UnixTimestampMs } from "@/contracts";
import { isTerminalStatus, type RunMetaState } from "@/worker/contracts";

import {
  CANCEL_GRACE_MS,
  logger,
  now,
  type RunExecutionContext,
  type RunExecutionOutcome,
} from "@/worker/dispatch/shared/run-execution-context";
import { type RunLeaseControl } from "@/worker/dispatch/shared/run-lease";
import { RunStateTransitionError } from "@/worker/durable/run-do/state";

type RunFinalizeContext = Pick<
  RunExecutionContext,
  "control" | "projectControl" | "runStore" | "runtime" | "scope" | "state"
>;

interface TerminalRunResult {
  terminalStatus: Extract<RunMetaState["status"], "passed" | "failed" | "canceled">;
  exitCode: number | null;
  errorMessage: string | null;
}

const isCancelTransitionState = (
  status: RunMetaState["status"],
): status is Extract<RunMetaState["status"], "cancel_requested" | "canceling"> =>
  status === "cancel_requested" || status === "canceling";

const shouldRetryTerminalization = (error: unknown): boolean => error instanceof RunStateTransitionError;

const toBaseTerminalResult = (outcome: Exclude<RunExecutionOutcome, { kind: "ownership_lost" }>): TerminalRunResult => {
  switch (outcome.kind) {
    case "passed":
      return {
        terminalStatus: "passed",
        exitCode: outcome.exitCode,
        errorMessage: null,
      };
    case "failed":
      return {
        terminalStatus: "failed",
        exitCode: outcome.exitCode,
        errorMessage: outcome.errorMessage,
      };
    case "canceled":
      return {
        terminalStatus: "canceled",
        exitCode: null,
        errorMessage: null,
      };
  }
};

const repairActiveStepState = async (
  context: RunFinalizeContext,
  outcome: RunExecutionOutcome,
  finishedAtValue: UnixTimestampMs,
): Promise<void> => {
  const position = context.state.currentStepPosition;
  if (position === null || outcome.kind === "passed" || outcome.kind === "ownership_lost") {
    return;
  }

  try {
    const detail = await context.runStore.getFreshStub().getRunDetail(context.scope.runId);
    const currentStep = detail.steps.find((step) => step.position === position);
    if (!currentStep || (currentStep.status !== "queued" && currentStep.status !== "running")) {
      return;
    }

    await context.runStore.updateStepState({
      position,
      status: "failed",
      finishedAt: finishedAtValue,
      exitCode: outcome.kind === "failed" ? outcome.exitCode : null,
    });
  } catch (error) {
    logger.warn("run_final_step_repair_failed", {
      ...context.scope.logContext,
      position,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

const finalizeRunCanceled = async (context: RunFinalizeContext, finishedAtValue: UnixTimestampMs): Promise<void> => {
  let current = await context.control.getRunMeta();
  if (current.status === "canceled") {
    return;
  }

  if (current.status === "passed" || current.status === "failed") {
    throw new RunStateTransitionError("already_terminal", current.status, "canceled");
  }

  if (current.status === "starting" || current.status === "running") {
    current = await context.control.updateRunFromCurrent(current, "cancel_requested", {
      startedAt: current.startedAt ?? context.scope.startedAt,
    });
  }

  if (current.status === "cancel_requested" || current.status === "canceling" || current.status === "queued") {
    await context.control.updateRunFromCurrent(current, "canceled", {
      currentStep: null,
      startedAt: current.status === "queued" ? current.startedAt : (current.startedAt ?? context.scope.startedAt),
      finishedAt: finishedAtValue,
      exitCode: null,
      errorMessage: null,
    });
    return;
  }

  throw new Error(`Run ${context.scope.runId} cannot be canceled from status ${current.status}.`);
};

const finalizeRunFailedAfterCancellation = async (
  context: RunFinalizeContext,
  finishedAtValue: UnixTimestampMs,
  exitCodeValue: number | null,
  errorMessageValue: string,
): Promise<void> => {
  let current = await context.control.getRunMeta();
  if (current.status === "failed") {
    return;
  }

  if (current.status === "passed" || current.status === "canceled") {
    throw new RunStateTransitionError("already_terminal", current.status, "failed");
  }

  if (current.status === "starting" || current.status === "running") {
    current = await context.control.updateRunFromCurrent(current, "cancel_requested", {
      startedAt: current.startedAt ?? context.scope.startedAt,
    });
  }

  if (current.status === "cancel_requested") {
    current = await context.control.updateRunFromCurrent(current, "canceling", {
      startedAt: current.startedAt ?? context.scope.startedAt,
    });
  }

  if (current.status !== "canceling") {
    throw new Error(`Run ${context.scope.runId} cannot fail after cancellation from status ${current.status}.`);
  }

  await context.control.updateRunFromCurrent(current, "failed", {
    currentStep: null,
    startedAt: current.startedAt ?? context.scope.startedAt,
    finishedAt: finishedAtValue,
    exitCode: exitCodeValue ?? 1,
    errorMessage: errorMessageValue,
  });
};

const finalizeRunTerminal = async (
  context: RunFinalizeContext,
  outcome: Exclude<RunExecutionOutcome, { kind: "ownership_lost" }>,
  finishedAtValue: UnixTimestampMs,
  sandboxDestroyedValue: boolean,
): Promise<TerminalRunResult> => {
  const desired = toBaseTerminalResult(outcome);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const current = await context.control.getRunMeta();
    if (isTerminalStatus(current.status)) {
      return {
        terminalStatus: current.status,
        exitCode: current.exitCode,
        errorMessage: current.errorMessage,
      };
    }

    const cancellationObserved = context.state.cancelRequestedAt !== null || isCancelTransitionState(current.status);
    const effective =
      cancellationObserved && !sandboxDestroyedValue
        ? {
            terminalStatus: "failed" as const,
            exitCode: 1,
            errorMessage: "cancel_cleanup_failed",
          }
        : cancellationObserved
          ? {
              terminalStatus: "canceled" as const,
              exitCode: null,
              errorMessage: null,
            }
          : desired;

    try {
      if (effective.terminalStatus === "canceled") {
        await finalizeRunCanceled(context, finishedAtValue);
      } else if (cancellationObserved && effective.terminalStatus === "failed") {
        await finalizeRunFailedAfterCancellation(
          context,
          finishedAtValue,
          effective.exitCode,
          effective.errorMessage ?? "cancel_cleanup_failed",
        );
      } else if (isCancelTransitionState(current.status)) {
        await context.runStore.repairTerminalState({
          status: effective.terminalStatus,
          currentStep: null,
          startedAt: current.startedAt ?? context.scope.startedAt,
          finishedAt: finishedAtValue,
          exitCode: effective.exitCode,
          errorMessage: effective.errorMessage,
        });
      } else {
        const updateResult = await context.runStore.tryUpdateState({
          status: effective.terminalStatus,
          currentStep: null,
          startedAt: current.startedAt ?? context.scope.startedAt,
          finishedAt: finishedAtValue,
          exitCode: effective.exitCode,
          errorMessage: effective.errorMessage,
        });

        if (updateResult.kind === "conflict") {
          throw new RunStateTransitionError(updateResult.reason, updateResult.current.status, effective.terminalStatus);
        }
      }

      return effective;
    } catch (error) {
      if (attempt === 0 && shouldRetryTerminalization(error)) {
        continue;
      }

      throw error;
    }
  }

  throw new Error(`Run ${context.scope.runId} terminalization exceeded retry budget.`);
};

export const finalizeExecution = async (
  context: RunFinalizeContext,
  lease: RunLeaseControl,
  outcome: RunExecutionOutcome,
): Promise<void> => {
  context.state.phase = "cleaning_up";

  try {
    if (context.state.session) {
      const cleanupSession = context.state.session;
      let hasLiveProcesses = false;
      try {
        hasLiveProcesses = await context.runtime.isProcessTreeAlive(cleanupSession);
      } catch (error) {
        logger.warn("run_final_process_tree_check_failed", {
          ...context.scope.logContext,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      if (!hasLiveProcesses) {
        try {
          await context.runtime.deleteSession(cleanupSession.id);
        } catch (error) {
          logger.warn("run_final_session_delete_failed", {
            ...context.scope.logContext,
            error: error instanceof Error ? error.message : String(error),
          });
        } finally {
          context.runtime.disposeSession(cleanupSession);
          context.state.session = null;
        }
      } else if (context.state.ownershipLost || outcome.kind === "ownership_lost") {
        await context.runtime.softCancelProcessTree(context.state.session, context.runtime.getLiveCurrentProcess());
        if (
          !(await context.runtime.waitForProcessTreeToStopSafely(
            context.state.session,
            CANCEL_GRACE_MS,
            "lost_ownership_grace",
          ))
        ) {
          await context.runtime.hardCancelProcessTree(context.state.session, context.runtime.getLiveCurrentProcess());
        }
      } else if (lease.isCancellationRequested()) {
        await lease.applyCancellationIfNeeded();
        let processTreeStopped = await context.runtime.waitForProcessTreeToStopSafely(
          context.state.session,
          CANCEL_GRACE_MS,
          "cancel_grace",
        );
        if (!processTreeStopped) {
          await context.runtime.hardCancelProcessTree(context.state.session, context.runtime.getLiveCurrentProcess());
          processTreeStopped = await context.runtime.waitForProcessTreeToStopSafely(
            context.state.session,
            5_000,
            "cancel_force",
          );
        }
        void processTreeStopped;
      } else if (await context.runtime.isProcessTreeAlive(context.state.session)) {
        await context.runtime.softCancelProcessTree(context.state.session, context.state.currentProcess);
      }

      const activeCleanupSession = context.state.session;
      if (
        activeCleanupSession &&
        !lease.isCancellationRequested() &&
        !(await context.runtime.waitForProcessTreeToStopSafely(activeCleanupSession, 5_000, "final_cleanup"))
      ) {
        await context.runtime.hardCancelProcessTree(activeCleanupSession, context.state.currentProcess);
      }
    }

    const sandboxDestroyed = await context.runtime.destroySandbox();

    if (!context.state.ownershipLost && outcome.kind !== "ownership_lost") {
      try {
        await lease.refreshControl();
      } catch (error) {
        logger.warn("run_final_control_check_failed", {
          ...context.scope.logContext,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (context.state.ownershipLost || outcome.kind === "ownership_lost") {
      const observedStatus =
        outcome.kind === "ownership_lost" ? outcome.observedStatus : context.state.ownershipLossStatus;
      logger.warn("run_finalization_skipped_lost_ownership", {
        ...context.scope.logContext,
        status: observedStatus,
      });
      return;
    }

    context.state.phase = "finalizing";
    const finishedAt = now();
    await repairActiveStepState(context, outcome, finishedAt);
    context.state.currentStepPosition = null;
    const terminal = await finalizeRunTerminal(context, outcome, finishedAt, sandboxDestroyed);

    await context.projectControl.finalizeRunExecution(terminal.terminalStatus, terminal.errorMessage, sandboxDestroyed);
    await context.projectControl.kickReconciliation("finalize_run_execution");
  } finally {
    context.runtime.disposeSession(context.state.session);
    context.state.session = null;
    // Keep heartbeats alive until ProjectDO has either accepted terminal state or taken ownership away.
    try {
      await lease.stop();
    } catch (error) {
      logger.warn("run_heartbeat_join_failed", {
        ...context.scope.logContext,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
};
