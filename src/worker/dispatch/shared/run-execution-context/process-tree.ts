import type { ExecutionSession, Process, Sandbox } from "@cloudflare/sandbox";

import { isNoContainerInstanceError } from "@/worker/sandbox/container-errors";

import { logger, sleep } from "./shared";
import type { RunExecutionContextState, RunExecutionScope } from "./types";

const isLiveProcess = (process: Process): boolean => process.status === "starting" || process.status === "running";

export const getLiveCurrentProcess = (state: RunExecutionContextState): Process | null =>
  state.currentProcess && isLiveProcess(state.currentProcess) ? state.currentProcess : null;

export const isProcessTreeAlive = async (session: ExecutionSession): Promise<boolean> => {
  const processes = await session.listProcesses();
  return processes.some(isLiveProcess);
};

export const softCancelProcessTree = async (
  scope: RunExecutionScope,
  state: RunExecutionContextState,
  session: ExecutionSession,
  process: Process | null,
): Promise<void> => {
  try {
    if (process) {
      await session.killProcess(process.id, "SIGTERM");
    } else {
      await session.killAllProcesses();
    }
  } catch (error) {
    logger.warn("run_soft_cancel_failed", {
      ...scope.logContext,
      phase: state.phase,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    await session.killAllProcesses();
  } catch (error) {
    logger.warn("run_soft_cancel_tree_failed", {
      ...scope.logContext,
      phase: state.phase,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

export const hardCancelProcessTree = async (
  scope: RunExecutionScope,
  state: RunExecutionContextState,
  session: ExecutionSession,
  process: Process | null,
): Promise<void> => {
  try {
    if (process) {
      await session.killProcess(process.id, "SIGKILL");
    }
  } catch (error) {
    logger.warn("run_hard_cancel_failed", {
      ...scope.logContext,
      phase: state.phase,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    await session.killAllProcesses();
  } catch (error) {
    logger.warn("run_hard_cancel_tree_failed", {
      ...scope.logContext,
      phase: state.phase,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

export const waitForProcessTreeToStop = async (
  session: ExecutionSession,
  timeoutMs: number,
  pollIntervalMs = 250,
): Promise<boolean> => {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (!(await isProcessTreeAlive(session))) {
      try {
        await session.cleanupCompletedProcesses();
      } catch {}
      return true;
    }

    await sleep(pollIntervalMs);
  }

  return !(await isProcessTreeAlive(session));
};

export const waitForProcessTreeToStopSafely = async (
  scope: RunExecutionScope,
  session: ExecutionSession,
  timeoutMs: number,
  cleanupPhase: string,
): Promise<boolean> => {
  try {
    return await waitForProcessTreeToStop(session, timeoutMs);
  } catch (error) {
    logger.warn("run_process_tree_wait_failed", {
      ...scope.logContext,
      phase: cleanupPhase,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
};

export const destroySandbox = async (
  scope: RunExecutionScope,
  state: RunExecutionContextState,
  sandbox: Pick<Sandbox, "destroy" | "setKeepAlive">,
): Promise<boolean> => {
  try {
    await sandbox.setKeepAlive(false);
  } catch (error) {
    logger.warn("sandbox_keep_alive_release_failed", {
      ...scope.logContext,
      phase: state.phase,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    await sandbox.destroy();
    return true;
  } catch (error) {
    if (isNoContainerInstanceError(error)) {
      return true;
    }

    logger.warn("sandbox_destroy_failed", {
      ...scope.logContext,
      phase: state.phase,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
};
