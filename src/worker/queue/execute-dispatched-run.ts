import { type ProjectId, type RunId } from "@/contracts";
import { isTerminalStatus, type ExecuteRunWork } from "@/worker/contracts";
import type { ProjectExecutionMaterial } from "@/worker/durable/project-do/types";

import {
  createRunExecutionContext,
  ensureRunInitialized,
  kickProjectReconciliation,
  logger,
  type RunExecutionContext,
  type RunExecutionOutcome,
} from "@/worker/queue/run-execution-context";
import { prepareExecutionEnvironment } from "@/worker/queue/run-environment";
import { finalizeExecution } from "@/worker/queue/run-finalize";
import { RunLease, RunOwnershipLostError } from "@/worker/queue/run-lease";
import { executeRunSteps } from "@/worker/queue/run-steps/executor";

export interface DispatchedRunResult {
  readonly kind: "executed" | "stale" | "recovered" | "project_missing";
  readonly reason?: string;
}

type RunErrorContext = Pick<RunExecutionContext, "logs" | "scope" | "state">;

const tryRecoverActiveRun = async (env: Env, projectId: ProjectId, runId: RunId): Promise<boolean> => {
  const runMeta = await env.RUN_DO.getByName(runId).getRunSummary(runId);
  if (!runMeta || !isTerminalStatus(runMeta.status) || runMeta.finishedAt === null) {
    return false;
  }

  // When sandbox work finished but the queue delivery retried before ProjectDO accepted terminalization,
  // recover from the trusted RunDO terminal state instead of letting the watchdog misclassify the run later.
  await env.PROJECT_DO.getByName(projectId).finalizeRunExecution({
    projectId,
    runId,
    terminalStatus: runMeta.status,
    lastError: runMeta.errorMessage,
    sandboxDestroyed: false,
  });
  await kickProjectReconciliation(env, projectId, runId, "recover_active_run");
  return true;
};

const appendFailureLogBestEffort = async (context: RunErrorContext, message: string): Promise<void> => {
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
  await appendFailureLogBestEffort(context, errorMessage);
  return {
    kind: "failed",
    exitCode: 1,
    errorMessage,
  };
};

const executeClaimedRun = async (
  env: Env,
  executionMaterial: ProjectExecutionMaterial,
  claim: ExecuteRunWork,
): Promise<void> => {
  await ensureRunInitialized(env, claim.snapshot);

  const context = createRunExecutionContext(env, executionMaterial, claim);
  const lease = new RunLease(context);
  lease.start();

  let outcome: RunExecutionOutcome;

  try {
    await context.runStore.updateState({
      status: "starting",
      startedAt: context.scope.startedAt,
      currentStep: null,
      finishedAt: null,
      exitCode: null,
      errorMessage: null,
    });
    lease.throwIfOwnershipLost();

    const prepared = await prepareExecutionEnvironment(context, lease);
    outcome =
      prepared === null
        ? {
            kind: "canceled",
          }
        : await executeRunSteps(context, lease, prepared);
  } catch (error) {
    outcome = await mapExecutionErrorToOutcome(context, error);
  }

  await finalizeExecution(context, lease, outcome);
};

export const executeDispatchedRun = async (
  env: Env,
  input: { projectId: ProjectId; runId: RunId },
): Promise<DispatchedRunResult> => {
  const projectStub = env.PROJECT_DO.getByName(input.projectId);
  const claim = await projectStub.claimRunWork({
    projectId: input.projectId,
    runId: input.runId,
  });

  if (claim.kind === "stale") {
    if (claim.reason === "run_active") {
      const recovered = await tryRecoverActiveRun(env, input.projectId, input.runId);
      if (recovered) {
        return { kind: "recovered" };
      }
    }

    return { kind: "stale", reason: claim.reason };
  }

  const executionMaterial = await projectStub.getProjectExecutionMaterial(input.projectId);
  if (!executionMaterial) {
    return { kind: "project_missing" };
  }

  await executeClaimedRun(env, executionMaterial, claim);
  return { kind: "executed" };
};
