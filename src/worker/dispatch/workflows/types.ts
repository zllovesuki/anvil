import { type UnixTimestampMs as UnixTimestampMsType } from "@/contracts";
import type { RunExecutionOutcome } from "@/worker/dispatch/shared/run-execution-context";

export interface ClaimedWorkflowStepResult {
  kind: "claimed";
  startedAt: UnixTimestampMsType;
}

export interface StaleWorkflowStepResult {
  kind: "stale";
  reason: string;
}

export interface RecoveredWorkflowStepResult {
  kind: "recovered";
}

export type WorkflowClaimResult = ClaimedWorkflowStepResult | RecoveredWorkflowStepResult | StaleWorkflowStepResult;
export type WorkflowRunTerminalStatus = Extract<RunExecutionOutcome["kind"], "passed" | "failed" | "canceled">;

export type WorkflowRunResult =
  | {
      kind: "executed";
      terminalStatus: WorkflowRunTerminalStatus;
    }
  | {
      kind: "recovered";
    }
  | {
      kind: "stale";
      reason: string;
    };
