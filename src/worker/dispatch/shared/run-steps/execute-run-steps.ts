import {
  now,
  toPositiveInteger,
  type PreparedExecutionEnvironment,
  type RunExecutionContext,
  type RunExecutionOutcome,
} from "@/worker/dispatch/shared/run-execution-context";
import { type RunLeaseControl } from "@/worker/dispatch/shared/run-lease";
import { executeSessionCommandStream, resolveExecStreamProcess, type CommandStreamResult } from "./command-stream";
import { createLogBatcher } from "./logging";

type RunStepExecutionContext = Pick<RunExecutionContext, "logs" | "runStore" | "scope" | "state">;

export const executeRunSteps = async (
  context: RunStepExecutionContext,
  lease: RunLeaseControl,
  prepared: PreparedExecutionEnvironment,
): Promise<RunExecutionOutcome> => {
  if (lease.isCancellationRequested()) {
    return {
      kind: "canceled",
    };
  }

  await context.runStore.updateState({
    status: "running",
    startedAt: context.scope.startedAt,
    currentStep: null,
    finishedAt: null,
    exitCode: null,
    errorMessage: null,
  });

  const deadline = context.scope.startedAt + prepared.repoConfig.run.timeoutSeconds * 1000;
  if (prepared.repoConfig.run.steps.length === 0) {
    return {
      kind: "passed",
      exitCode: 0,
    };
  }

  let lastExitCode: number | null = null;

  for (const [index, step] of prepared.repoConfig.run.steps.entries()) {
    context.state.phase = "running_step";
    lease.throwIfOwnershipLost();
    if (lease.isCancellationRequested()) {
      return {
        kind: "canceled",
      };
    }

    const position = toPositiveInteger(index + 1);
    const stepStartedAt = now();
    const remainingMs = deadline - stepStartedAt;
    if (remainingMs <= 0) {
      throw new Error("Run exceeded timeout before the next step started.");
    }

    context.state.currentStepPosition = position;
    await context.runStore.updateState({
      status: "running",
      startedAt: context.scope.startedAt,
      currentStep: position,
      finishedAt: null,
      exitCode: null,
      errorMessage: null,
    });
    await context.runStore.updateStepState({
      position,
      status: "running",
      startedAt: stepStartedAt,
      finishedAt: null,
      exitCode: null,
    });

    const executionSession = context.state.session;
    if (!executionSession) {
      throw new Error(`Run ${context.scope.runId} lost its execution session.`);
    }

    const batcher = createLogBatcher(context);

    await lease.applyCancellationIfNeeded();
    lease.throwIfOwnershipLost();

    let commandResult: CommandStreamResult;
    try {
      commandResult = await executeSessionCommandStream(
        executionSession,
        step.run,
        {
          cwd: prepared.workingDirectory,
          timeout: remainingMs,
        },
        batcher,
        {
          onStart:
            "listProcesses" in executionSession
              ? async (event) => {
                  context.state.currentProcess = await resolveExecStreamProcess(executionSession, step.run, event.pid);
                }
              : undefined,
        },
      );
    } finally {
      context.state.currentProcess = null;
    }
    const stepFinishedAt = now();
    lease.throwIfOwnershipLost();

    if (lease.isCancellationRequested()) {
      await context.runStore.updateStepState({
        position,
        status: "failed",
        startedAt: stepStartedAt,
        finishedAt: stepFinishedAt,
        exitCode: commandResult.exitCode,
      });
      return {
        kind: "canceled",
      };
    }

    if (commandResult.terminalEvent !== "complete" || commandResult.exitCode !== 0) {
      await context.runStore.updateStepState({
        position,
        status: "failed",
        startedAt: stepStartedAt,
        finishedAt: stepFinishedAt,
        exitCode: commandResult.exitCode,
      });
      return {
        kind: "failed",
        exitCode: commandResult.exitCode,
        errorMessage: context.logs.redactMessage(
          commandResult.stderr || commandResult.errorMessage || `Step "${step.name}" failed.`,
        ),
      };
    }

    await context.runStore.updateStepState({
      position,
      status: "passed",
      startedAt: stepStartedAt,
      finishedAt: stepFinishedAt,
      exitCode: commandResult.exitCode,
    });
    lastExitCode = commandResult.exitCode;
  }

  return {
    kind: "passed",
    exitCode: lastExitCode,
  };
};
