import {
  logger,
  type RunExecutionContext,
  type RunExecutionOutcome,
} from "@/worker/dispatch/shared/run-execution-context";
import { RunOwnershipLostError } from "@/worker/dispatch/shared/run-lease";

type RunErrorContext = Pick<RunExecutionContext, "logs" | "scope" | "state">;

export const appendFailureLogBestEffort = async (
  context: Pick<RunErrorContext, "logs" | "scope">,
  message: string,
): Promise<void> => {
  try {
    await context.logs.appendSystemLog(message);
  } catch (error) {
    logger.warn("run_error_log_append_failed", {
      ...context.scope.logContext,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

export const mapExecutionErrorToOutcome = async (
  context: RunErrorContext,
  error: unknown,
): Promise<RunExecutionOutcome> => {
  if (error instanceof RunOwnershipLostError) {
    return {
      kind: "ownership_lost",
      observedStatus: error.observedStatus,
    };
  }

  if (context.state.cancelRequestedAt !== null) {
    return {
      kind: "canceled",
    };
  }

  const errorMessage = context.logs.redactMessage(error instanceof Error ? error.message : String(error));
  return {
    kind: "failed",
    exitCode: 1,
    errorMessage,
  };
};
