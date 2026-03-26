import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";

import { type UnixTimestampMs as UnixTimestampMsType } from "@/contracts";
import {
  AcceptedRunSnapshot as AcceptedRunSnapshotCodec,
  type RecoverWorkflowDispatchFailureResult,
  isTerminalStatus,
  type AcceptedRunSnapshot,
} from "@/worker/contracts";
import { recoverTerminalActiveRun } from "@/worker/dispatch/shared";
import { claimWorkflowRun, executeWorkflowRun, finalizeWorkflowRun } from "./steps/index";
import type { WorkflowRunResult } from "./types";
import { boundedRetryStepConfig } from "./step-config";
import { toWorkflowStartedAt } from "./execution";

const finalizeFailedWorkflowExecution = async (
  env: Env,
  snapshot: AcceptedRunSnapshot,
  startedAt: UnixTimestampMsType,
  error: unknown,
): Promise<WorkflowRunResult> => {
  const runMeta = await env.RUN_DO.getByName(snapshot.runId).getRunSummary(snapshot.runId);
  await finalizeWorkflowRun(
    env,
    snapshot,
    startedAt,
    {
      kind: "failed",
      exitCode: 1,
      errorMessage: error instanceof Error ? error.message : String(error),
    },
    runMeta?.currentStep ?? null,
  );

  const finalizedMeta = await env.RUN_DO.getByName(snapshot.runId).getRunSummary(snapshot.runId);
  return {
    kind: "executed",
    terminalStatus:
      finalizedMeta && isTerminalStatus(finalizedMeta.status) && finalizedMeta.finishedAt !== null
        ? finalizedMeta.status
        : "failed",
  };
};

export class RunWorkflows extends WorkflowEntrypoint<Env, AcceptedRunSnapshot> {
  async run(event: WorkflowEvent<AcceptedRunSnapshot>, step: WorkflowStep): Promise<WorkflowRunResult> {
    const snapshot = AcceptedRunSnapshotCodec.assertDecode(event.payload);
    let startedAt: UnixTimestampMsType | null = null;

    try {
      const claimResult = await claimWorkflowRun(step, this.env, snapshot);

      if (claimResult.kind === "recovered") {
        return claimResult;
      }

      if (claimResult.kind === "stale") {
        return claimResult;
      }

      startedAt = claimResult.startedAt;

      return {
        kind: "executed",
        terminalStatus: await executeWorkflowRun(step, this.env, snapshot, claimResult.startedAt),
      };
    } catch (error) {
      let executionError: unknown = error;
      // These catch-path repairs only reconcile durable DO state, so replaying them is safe
      // without introducing extra workflow steps.

      if (startedAt === null) {
        const recovery = await step.do(
          "rearm dispatch",
          boundedRetryStepConfig(),
          async (): Promise<RecoverWorkflowDispatchFailureResult> =>
            await this.env.PROJECT_DO.getByName(snapshot.projectId).recoverWorkflowDispatchFailure({
              projectId: snapshot.projectId,
              runId: snapshot.runId,
              errorMessage: executionError instanceof Error ? executionError.message : String(executionError),
            }),
        );

        if (recovery.kind === "rearmed") {
          return {
            kind: "stale",
            reason: "dispatch_rearmed",
          };
        }

        if (recovery.kind === "already_active") {
          const runMeta = await this.env.RUN_DO.getByName(snapshot.runId).getRunSummary(snapshot.runId);
          if (runMeta && isTerminalStatus(runMeta.status) && runMeta.finishedAt !== null) {
            if (await recoverTerminalActiveRun(this.env, snapshot.projectId, snapshot.runId)) {
              return {
                kind: "recovered",
              };
            }

            return {
              kind: "stale",
              reason: "already_terminal",
            };
          }

          startedAt = runMeta?.startedAt ?? toWorkflowStartedAt(Date.now());
          try {
            return {
              kind: "executed",
              terminalStatus: await executeWorkflowRun(step, this.env, snapshot, startedAt),
            };
          } catch (resumeError) {
            return await finalizeFailedWorkflowExecution(this.env, snapshot, startedAt, resumeError);
          }
        }

        return {
          kind: "stale",
          reason: recovery.kind,
        };
      }

      return await finalizeFailedWorkflowExecution(this.env, snapshot, startedAt, executionError);
    }
  }
}
