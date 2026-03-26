import { type UnixTimestampMs as UnixTimestampMsType } from "@/contracts";
import { isTerminalStatus, type AcceptedRunSnapshot } from "@/worker/contracts";
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
import { type WorkflowStep } from "cloudflare:workers";
import { toWorkflowClaim, toWorkflowTerminalStatus, getWorkflowExecutionSessionId } from "../execution";
import { noRetryStepConfig } from "../step-config";
import type { WorkflowRunTerminalStatus } from "../types";

// This step wraps sandbox reset, checkout/config loading, repo execution, and finalization,
// so it needs more headroom than the repo-defined run timeout alone.
const WORKFLOW_EXECUTE_TIMEOUT_MS = 30 * 60 * 1_000;

type WorkflowExecutionBootstrapResult =
  | {
      kind: "continue";
    }
  | {
      kind: "terminal";
      terminalStatus: WorkflowRunTerminalStatus;
    }
  | {
      kind: "canceled";
    };

const resolveWorkflowExecutionBootstrap = async (
  env: Env,
  snapshot: AcceptedRunSnapshot,
  startedAt: UnixTimestampMsType,
  context: ReturnType<typeof createRunExecutionContext>,
  lease: RunLease,
): Promise<WorkflowExecutionBootstrapResult> => {
  await ensureRunInitialized(env, snapshot);
  await lease.refreshControl();
  lease.throwIfOwnershipLost();

  const runMeta = await context.runStore.getMeta();
  if (isTerminalStatus(runMeta.status)) {
    if (runMeta.finishedAt === null) {
      throw new Error(`Run ${snapshot.runId} is terminal in status ${runMeta.status} without finishedAt.`);
    }

    await recoverTerminalActiveRun(env, snapshot.projectId, snapshot.runId);
    return {
      kind: "terminal",
      terminalStatus: runMeta.status,
    };
  }

  if (lease.isCancellationRequested() || runMeta.status === "cancel_requested" || runMeta.status === "canceling") {
    context.state.cancelRequestedAt = context.state.cancelRequestedAt ?? runMeta.startedAt ?? startedAt;
    context.state.currentStepPosition = runMeta.currentStep;
    return {
      kind: "canceled",
    };
  }

  if (runMeta.status === "queued") {
    await context.runStore.updateState({
      status: "starting",
      startedAt,
      currentStep: null,
      finishedAt: null,
      exitCode: null,
      errorMessage: null,
    });
    lease.throwIfOwnershipLost();
    return {
      kind: "continue",
    };
  }

  if (runMeta.status === "starting" || runMeta.status === "running") {
    // Preserve the currently reported repo step for cancellation/finalization repair.
    // A workflow replay still rebuilds a fresh sandbox and reruns repo-defined steps
    // from the start of the internal execution loop.
    context.state.currentStepPosition = runMeta.currentStep;
    return {
      kind: "continue",
    };
  }

  throw new Error(`Run ${snapshot.runId} cannot execute from status ${runMeta.status}.`);
};

export const executeWorkflowRun = async (
  step: WorkflowStep,
  env: Env,
  snapshot: AcceptedRunSnapshot,
  startedAt: UnixTimestampMsType,
): Promise<WorkflowRunTerminalStatus> =>
  await step.do(
    "execute run",
    noRetryStepConfig(WORKFLOW_EXECUTE_TIMEOUT_MS),
    async (): Promise<WorkflowRunTerminalStatus> => {
      const executionMaterial = await env.PROJECT_DO.getByName(snapshot.projectId).getProjectExecutionMaterial(
        snapshot.projectId,
      );
      if (!executionMaterial) {
        throw new Error(`Project ${snapshot.projectId} execution material is unavailable.`);
      }

      const executionSessionId = getWorkflowExecutionSessionId(snapshot.runId);
      const context = createRunExecutionContext(env, executionMaterial, toWorkflowClaim(snapshot), {
        startedAt,
      });
      const lease = new RunLease(context);
      lease.start();

      let outcome: RunExecutionOutcome;

      try {
        try {
          const bootstrap = await resolveWorkflowExecutionBootstrap(env, snapshot, startedAt, context, lease);
          if (bootstrap.kind === "terminal") {
            return bootstrap.terminalStatus;
          }

          if (bootstrap.kind === "canceled") {
            outcome = {
              kind: "canceled",
            };
          } else {
            if (!(await context.runtime.destroySandbox())) {
              throw new Error(`Failed to reset sandbox for run ${snapshot.runId}.`);
            }

            const prepared = await prepareExecutionEnvironment(context, lease, {
              executionSessionId,
            });
            outcome =
              prepared === null
                ? {
                    kind: "canceled",
                  }
                : await executeRunSteps(context, lease, prepared);
          }
        } catch (error) {
          outcome = await mapExecutionErrorToOutcome(context, error);
          if (outcome.kind === "failed") {
            await appendFailureLogBestEffort(context, outcome.errorMessage);
          }
        }

        await finalizeExecution(context, lease, outcome);

        const runMeta = await env.RUN_DO.getByName(snapshot.runId).getRunSummary(snapshot.runId);
        if (runMeta && isTerminalStatus(runMeta.status) && runMeta.finishedAt !== null) {
          return runMeta.status;
        }

        return toWorkflowTerminalStatus(outcome);
      } finally {
        context.runtime.dispose();
      }
    },
  );
