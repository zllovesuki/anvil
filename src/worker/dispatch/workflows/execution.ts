import { UnixTimestampMs, type UnixTimestampMs as UnixTimestampMsType } from "@/contracts";
import { type AcceptedRunSnapshot, type ExecuteRunWork } from "@/worker/contracts";
import { type RunExecutionOutcome } from "@/worker/dispatch/shared/run-execution-context";
import type { ProjectExecutionMaterial } from "@/worker/durable/project-do/types";
import type { WorkflowRunTerminalStatus } from "./types";

const WORKFLOW_SESSION_PREFIX = "run";

export const getWorkflowExecutionSessionId = (runId: string): string => `${WORKFLOW_SESSION_PREFIX}-${runId}`;

export const toWorkflowClaim = (snapshot: AcceptedRunSnapshot): ExecuteRunWork => ({
  kind: "execute",
  snapshot,
});

export const toExecutionMaterial = (snapshot: AcceptedRunSnapshot): ProjectExecutionMaterial => ({
  projectId: snapshot.projectId,
  encryptedRepoToken: null,
});

export const toWorkflowStartedAt = (value: number): UnixTimestampMsType => UnixTimestampMs.assertDecode(value);

export const toWorkflowTerminalStatus = (outcome: RunExecutionOutcome): WorkflowRunTerminalStatus =>
  outcome.kind === "ownership_lost" ? "failed" : outcome.kind;
