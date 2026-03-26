import { type ProjectId, type RunId } from "@/contracts";
import { type ExecuteRunWork } from "@/worker/contracts";
import {
  createRunExecutionContext,
  ensureRunInitialized,
  type RunExecutionOutcome,
} from "@/worker/dispatch/shared/run-execution-context";
import {
  appendFailureLogBestEffort,
  executeRunSteps,
  finalizeExecution,
  mapExecutionErrorToOutcome,
  prepareExecutionEnvironment,
  recoverTerminalActiveRun,
  RunLease,
} from "@/worker/dispatch/shared";
import type { ProjectExecutionMaterial } from "@/worker/durable/project-do/types";

export interface DispatchedRunResult {
  readonly kind: "executed" | "stale" | "recovered" | "project_missing";
  readonly reason?: string;
}

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
    if (outcome.kind === "failed") {
      await appendFailureLogBestEffort(context, outcome.errorMessage);
    }
  }

  try {
    await finalizeExecution(context, lease, outcome);
  } finally {
    context.runtime.dispose();
  }
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
      const recovered = await recoverTerminalActiveRun(env, input.projectId, input.runId);
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
