import { eq } from "drizzle-orm";

import {
  type DispatchMode,
  type ExecutionRuntime,
  type UserId,
  type BranchName,
  RunId,
  UnixTimestampMs,
} from "@/contracts";
import {
  type AcceptManualRunResult,
  type AcceptQueuedRunInput,
  type ClaimRunWorkInput,
  type ClaimRunWorkResult,
  type EnsureRunInput,
  expectTrusted,
} from "@/worker/contracts";
import * as projectSchema from "@/worker/db/durable/schema/project-do";
import { generateDurableEntityId } from "@/worker/services";

import { countQueuedRuns, getHighestQueuePosition, getProjectStateRow, getRunRow } from "../repo";
import { ensureProjectState, getSnapshot } from "./shared";
import type { ProjectDoContext, ProjectStore } from "../types";

type AcceptedManualRun = Extract<AcceptManualRunResult, { kind: "accepted" }>;
type RejectedManualRun = Extract<AcceptManualRunResult, { kind: "rejected" }>;

export interface ResolvedAcceptManualRunInput {
  projectId: AcceptQueuedRunInput["projectId"];
  triggeredByUserId: UserId;
  branch: BranchName;
  repoUrl: string;
  configPath: string;
  dispatchMode: DispatchMode;
  executionRuntime: ExecutionRuntime;
}

export interface AcceptedQueuedRunTransition extends AcceptedManualRun {
  runInitialization: EnsureRunInput;
}

export type AcceptQueuedRunTransition = AcceptedQueuedRunTransition | RejectedManualRun;

export const transitionAcceptQueuedRun = (
  context: ProjectDoContext,
  tx: ProjectStore,
  input: AcceptQueuedRunInput,
  currentTime: number,
): AcceptQueuedRunTransition => {
  ensureProjectState(context, tx, input.projectId);

  const queuedCount = countQueuedRuns(tx, input.projectId);
  if (queuedCount >= 20) {
    return {
      kind: "rejected",
      reason: "queue_full",
    };
  }

  const runId = expectTrusted(RunId, generateDurableEntityId("run", currentTime), "RunId");
  const queuedAt = expectTrusted(UnixTimestampMs, currentTime, "UnixTimestampMs");
  const stateRow = getProjectStateRow(tx, input.projectId);
  const executable = stateRow?.activeRunId === null && queuedCount === 0;
  const position = getHighestQueuePosition(tx, input.projectId) + 1;

  tx.insert(projectSchema.projectRuns)
    .values({
      id: runId,
      projectId: input.projectId,
      runId,
      triggerType: input.triggerType,
      triggeredByUserId: input.triggeredByUserId,
      branch: input.branch,
      commitSha: input.commitSha,
      provider: input.provider,
      deliveryId: input.deliveryId,
      repoUrl: input.repoUrl,
      configPath: input.configPath,
      dispatchMode: input.dispatchMode,
      executionRuntime: input.executionRuntime,
      position,
      status: executable ? "executable" : "pending",
      d1SyncStatus: "needs_create",
      dispatchStatus: executable ? "pending" : "blocked",
      dispatchAttempts: 0,
      lastError: null,
      createdAt: currentTime,
      cancelRequestedAt: null,
    })
    .run();

  return {
    kind: "accepted",
    runId,
    queuedAt,
    executable,
    runInitialization: {
      runId,
      projectId: input.projectId,
      triggerType: input.triggerType,
      branch: input.branch,
      commitSha: input.commitSha,
    },
  };
};

export const transitionAcceptManualRun = (
  context: ProjectDoContext,
  tx: ProjectStore,
  input: ResolvedAcceptManualRunInput,
  currentTime: number,
): AcceptQueuedRunTransition =>
  transitionAcceptQueuedRun(
    context,
    tx,
    {
      projectId: input.projectId,
      triggerType: "manual",
      triggeredByUserId: input.triggeredByUserId,
      branch: input.branch,
      commitSha: null,
      repoUrl: input.repoUrl,
      configPath: input.configPath,
      provider: null,
      deliveryId: null,
      dispatchMode: input.dispatchMode,
      executionRuntime: input.executionRuntime,
    },
    currentTime,
  );

export const transitionClaimRunWork = (
  context: ProjectDoContext,
  tx: ProjectStore,
  input: ClaimRunWorkInput,
): ClaimRunWorkResult => {
  ensureProjectState(context, tx, input.projectId);

  const row = getRunRow(tx, input.projectId, input.runId);
  if (!row) {
    return { kind: "stale", reason: "run_missing" };
  }

  if (row.status === "canceled") {
    return { kind: "stale", reason: "canceled" };
  }

  if (row.status === "active" || row.status === "cancel_requested") {
    return { kind: "stale", reason: "run_active" };
  }

  if (row.status === "passed" || row.status === "failed") {
    return { kind: "stale", reason: "already_terminal" };
  }

  const stateRow = getProjectStateRow(tx, input.projectId);
  if (stateRow?.activeRunId && stateRow.activeRunId !== input.runId) {
    return { kind: "stale", reason: "superseded" };
  }

  if (row.status === "executable" && (row.dispatchStatus === "pending" || row.dispatchStatus === "queued")) {
    tx.update(projectSchema.projectRuns)
      .set({
        status: "active",
        position: null,
        dispatchStatus: "started",
      })
      .where(eq(projectSchema.projectRuns.runId, input.runId))
      .run();
    tx.update(projectSchema.projectState)
      .set({
        activeRunId: input.runId,
        updatedAt: Date.now(),
      })
      .where(eq(projectSchema.projectState.projectId, input.projectId))
      .run();

    return {
      kind: "execute",
      snapshot: getSnapshot(row),
    };
  }

  return { kind: "stale", reason: "not_currently_executable" };
};
