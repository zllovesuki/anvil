import { type Process } from "@cloudflare/sandbox";

import {
  now,
  PROCESS_WAIT_BUFFER_MS,
  toPositiveInteger,
  type PreparedExecutionEnvironment,
  type RunExecutionContext,
  type RunExecutionOutcome,
} from "@/worker/queue/run-execution-context";
import { type RunLeaseControl } from "@/worker/queue/run-lease";
import { createLogBatcher, createProcessLogCollector, type ProcessLogSnapshot } from "./logging";

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
    context.state.currentProcess = await executionSession.startProcess(step.run, {
      cwd: prepared.workingDirectory,
      timeout: remainingMs,
      autoCleanup: false,
    });
    const processId = context.state.currentProcess.id;
    const logCollector = createProcessLogCollector(executionSession, processId, batcher, context);

    await lease.applyCancellationIfNeeded();
    lease.throwIfOwnershipLost();

    let stepResultExitCode: number | null = null;
    let processStatus: Process["status"] | null = null;
    let processLogs: ProcessLogSnapshot = { stdout: "", stderr: "" };
    let waitForLogStream = true;

    try {
      const waitResult = await context.state.currentProcess.waitForExit(remainingMs + PROCESS_WAIT_BUFFER_MS);
      stepResultExitCode = waitResult.exitCode;
    } catch (error) {
      if (!lease.isCancellationRequested()) {
        waitForLogStream = false;
        throw error;
      }
    } finally {
      processLogs = await logCollector.complete({ waitForStream: waitForLogStream });
    }

    const processInfo = await executionSession.getProcess(processId);
    processStatus = processInfo?.status ?? null;
    stepResultExitCode = processInfo?.exitCode ?? stepResultExitCode;
    const stepFinishedAt = now();
    lease.throwIfOwnershipLost();

    if (lease.isCancellationRequested()) {
      await context.runStore.updateStepState({
        position,
        status: "failed",
        startedAt: stepStartedAt,
        finishedAt: stepFinishedAt,
        exitCode: stepResultExitCode,
      });
      context.state.currentProcess = null;
      return {
        kind: "canceled",
      };
    }

    if (
      stepResultExitCode !== 0 ||
      processStatus === "failed" ||
      processStatus === "killed" ||
      processStatus === "error"
    ) {
      await context.runStore.updateStepState({
        position,
        status: "failed",
        startedAt: stepStartedAt,
        finishedAt: stepFinishedAt,
        exitCode: stepResultExitCode,
      });
      context.state.currentProcess = null;
      return {
        kind: "failed",
        exitCode: stepResultExitCode,
        errorMessage: context.logs.redactMessage(processLogs.stderr || `Step "${step.name}" failed.`),
      };
    }

    await context.runStore.updateStepState({
      position,
      status: "passed",
      startedAt: stepStartedAt,
      finishedAt: stepFinishedAt,
      exitCode: stepResultExitCode,
    });
    lastExitCode = stepResultExitCode;
    context.state.currentProcess = null;
  }

  return {
    kind: "passed",
    exitCode: lastExitCode,
  };
};
