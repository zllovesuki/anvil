import { type UnixTimestampMs as UnixTimestampMsType } from "@/contracts";
import { type AcceptedRunSnapshot, type PositiveInteger } from "@/worker/contracts";
import { createRunExecutionContext, type RunExecutionOutcome } from "@/worker/dispatch/shared/run-execution-context";
import { finalizeExecution, RunLease } from "@/worker/dispatch/shared";
import { toExecutionMaterial, toWorkflowClaim } from "../execution";

export const finalizeWorkflowRun = async (
  env: Env,
  snapshot: AcceptedRunSnapshot,
  startedAt: UnixTimestampMsType,
  outcome: RunExecutionOutcome,
  position: PositiveInteger | null = null,
): Promise<void> => {
  const context = createRunExecutionContext(env, toExecutionMaterial(snapshot), toWorkflowClaim(snapshot), {
    startedAt,
  });
  const lease = new RunLease(context);

  if (position !== null) {
    context.state.currentStepPosition = position;
  }

  try {
    await finalizeExecution(context, lease, outcome);
  } finally {
    context.runtime.dispose();
  }
};
