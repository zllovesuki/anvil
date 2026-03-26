import { type WorkflowStep } from "cloudflare:workers";

import { type AcceptedRunSnapshot, isTerminalStatus } from "@/worker/contracts";
import { recoverTerminalActiveRun } from "@/worker/dispatch/shared/active-run-recovery";
import { toWorkflowStartedAt } from "../execution";
import { boundedRetryStepConfig } from "../step-config";
import type { WorkflowClaimResult } from "../types";

export const claimWorkflowRun = async (
  step: WorkflowStep,
  env: Env,
  snapshot: AcceptedRunSnapshot,
): Promise<WorkflowClaimResult> =>
  await step.do("claim run", boundedRetryStepConfig(), async (): Promise<WorkflowClaimResult> => {
    const projectStub = env.PROJECT_DO.getByName(snapshot.projectId);
    const claim = await projectStub.claimRunWork({
      projectId: snapshot.projectId,
      runId: snapshot.runId,
    });

    if (claim.kind === "execute") {
      return {
        kind: "claimed",
        startedAt: toWorkflowStartedAt(Date.now()),
      };
    }

    if (claim.reason === "run_active") {
      const current = await env.RUN_DO.getByName(snapshot.runId).getRunSummary(snapshot.runId);
      if (current && isTerminalStatus(current.status) && current.finishedAt !== null) {
        if (await recoverTerminalActiveRun(env, snapshot.projectId, snapshot.runId)) {
          return {
            kind: "recovered",
          };
        }

        return {
          kind: "stale",
          reason: "already_terminal",
        };
      }

      return {
        kind: "claimed",
        startedAt: current?.startedAt ?? toWorkflowStartedAt(Date.now()),
      };
    }

    return {
      kind: "stale",
      reason: claim.reason,
    };
  });
