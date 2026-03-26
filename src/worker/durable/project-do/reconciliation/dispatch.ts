import { and, eq } from "drizzle-orm";

import { DispatchMode, type ProjectId, RunId } from "@/contracts";
import { D1SyncStatus, expectTrusted } from "@/worker/contracts";
import * as projectSchema from "@/worker/db/durable/schema/project-do";

import { DISPATCH_RETRY_DELAYS_MS } from "../constants";
import { getNextDispatchableRun, getOldestCancelRequestedRun, getRunRow } from "../repo";
import { setRunDoTerminal, updateRunDoCancelRequested } from "../run-do-sync";
import { getDispatchRetryAt, setDispatchRetryAt } from "../sidecar-state";
import { classifyWorkflowDispatchState, dispatchRun } from "./dispatch-helper";
import { getRetryDelay } from "./shared";
import { getSnapshot, nextTerminalD1SyncStatus, promoteNextPendingRun } from "../transitions/shared";
import type { ProjectDoContext } from "../types";

type WorkflowDispatchCompletionState = "still_queued" | "rearmed" | "left_executable" | "missing";
type DispatchFailureResult =
  | { kind: "stale" }
  | { kind: "retry"; nextAt: number }
  | { kind: "terminal"; row: NonNullable<ReturnType<typeof getRunRow>> };

const markWorkflowRunQueued = (context: ProjectDoContext, projectId: ProjectId, runId: RunId): boolean =>
  context.db.transaction((tx) => {
    const currentRow = getRunRow(tx, projectId, runId);
    if (!currentRow || currentRow.status !== "executable" || currentRow.dispatchStatus !== "pending") {
      return false;
    }

    tx.update(projectSchema.projectRuns)
      .set({
        dispatchStatus: "queued",
        lastError: null,
      })
      .where(eq(projectSchema.projectRuns.runId, currentRow.runId))
      .run();
    return true;
  });

const getWorkflowDispatchCompletionState = (
  context: ProjectDoContext,
  projectId: ProjectId,
  runId: RunId,
): WorkflowDispatchCompletionState =>
  context.db.transaction((tx) => {
    const currentRow = getRunRow(tx, projectId, runId);
    if (!currentRow) {
      return "missing";
    }

    if (currentRow.status === "executable" && currentRow.dispatchStatus === "queued") {
      return "still_queued";
    }

    if (currentRow.status === "executable" && currentRow.dispatchStatus === "pending") {
      return "rearmed";
    }

    return "left_executable";
  });

const getQueuedWorkflowRun = async (context: ProjectDoContext, projectId: ProjectId) => {
  const rows = await context.db
    .select()
    .from(projectSchema.projectRuns)
    .where(
      and(
        eq(projectSchema.projectRuns.projectId, projectId),
        eq(projectSchema.projectRuns.status, "executable"),
        eq(projectSchema.projectRuns.dispatchStatus, "queued"),
        eq(projectSchema.projectRuns.dispatchMode, "workflows"),
      ),
    )
    .limit(1);

  return rows[0];
};

const resolveDispatchFailure = async (
  context: ProjectDoContext,
  projectId: ProjectId,
  runId: RunId,
  dispatchMode: DispatchMode,
  errorMessage: string,
): Promise<DispatchFailureResult> =>
  await context.db.transaction((tx) => {
    const currentRow = getRunRow(tx, projectId, runId);
    if (!currentRow || currentRow.status !== "executable") {
      return {
        kind: "stale",
      };
    }

    const expectedDispatchStatus = dispatchMode === "workflows" ? "queued" : "pending";
    if (currentRow.dispatchStatus !== expectedDispatchStatus) {
      return {
        kind: "stale",
      };
    }

    const nextAttempt = currentRow.dispatchAttempts + 1;
    if (nextAttempt > DISPATCH_RETRY_DELAYS_MS.length) {
      tx.update(projectSchema.projectRuns)
        .set({
          status: "failed",
          position: null,
          dispatchStatus: "terminal",
          dispatchAttempts: nextAttempt,
          d1SyncStatus: nextTerminalD1SyncStatus(expectTrusted(D1SyncStatus, currentRow.d1SyncStatus, "D1SyncStatus")),
          lastError: "dispatch_failed",
        })
        .where(eq(projectSchema.projectRuns.runId, currentRow.runId))
        .run();
      promoteNextPendingRun(tx, projectId);

      return {
        kind: "terminal",
        row: currentRow,
      };
    }

    tx.update(projectSchema.projectRuns)
      .set({
        dispatchStatus: dispatchMode === "workflows" ? "pending" : currentRow.dispatchStatus,
        dispatchAttempts: nextAttempt,
        lastError: errorMessage,
      })
      .where(eq(projectSchema.projectRuns.runId, currentRow.runId))
      .run();

    return {
      kind: "retry",
      nextAt: Date.now() + getRetryDelay(nextAttempt, DISPATCH_RETRY_DELAYS_MS),
    };
  });

const applyDispatchFailure = async (
  context: ProjectDoContext,
  projectId: ProjectId,
  runId: RunId,
  dispatchMode: DispatchMode,
  dispatchAttempts: number,
  errorMessage: string,
): Promise<DispatchFailureResult["kind"]> => {
  const result = await resolveDispatchFailure(context, projectId, runId, dispatchMode, errorMessage);

  if (result.kind === "stale") {
    return result.kind;
  }

  if (result.kind === "terminal") {
    await setDispatchRetryAt(context, runId, null);
    try {
      await setRunDoTerminal(context, result.row, "failed", "dispatch_failed");
    } catch (runDoError) {
      context.logger.error("dispatch_failed_run_do_terminalize_failed", {
        projectId,
        runId,
        error: runDoError instanceof Error ? runDoError.message : String(runDoError),
      });
    }
    return result.kind;
  }

  await setDispatchRetryAt(context, runId, result.nextAt);
  context.logger.error("run_dispatch_failed", {
    projectId,
    runId,
    attempt: dispatchAttempts + 1,
    error: errorMessage,
  });
  return result.kind;
};

const reconcileQueuedWorkflowRun = async (context: ProjectDoContext, projectId: ProjectId): Promise<void> => {
  const row = await getQueuedWorkflowRun(context, projectId);
  if (!row) {
    return;
  }

  const runId = expectTrusted(RunId, row.runId, "RunId");

  try {
    const instance = await context.env.RUN_WORKFLOWS.get(runId);
    const current = await instance.status();

    switch (classifyWorkflowDispatchState(current.status)) {
      case "already_dispatched":
        return;
      case "restartable":
        await applyDispatchFailure(
          context,
          projectId,
          runId,
          "workflows",
          row.dispatchAttempts,
          `Workflow instance ${runId} reached terminal status ${current.status} before ProjectDO accepted the dispatch.`,
        );
        return;
      case "unsupported":
        await applyDispatchFailure(
          context,
          projectId,
          runId,
          "workflows",
          row.dispatchAttempts,
          `Workflow instance ${runId} has unsupported status ${current.status}.`,
        );
        return;
    }
  } catch (error) {
    await applyDispatchFailure(
      context,
      projectId,
      runId,
      "workflows",
      row.dispatchAttempts,
      error instanceof Error ? error.message : String(error),
    );
  }
};

export const reconcileCancelRequestedRunDo = async (
  context: ProjectDoContext,
  projectId: ProjectId,
): Promise<RunId | null> => {
  const row = await getOldestCancelRequestedRun(context, projectId);
  if (!row) {
    return null;
  }

  try {
    const outcome = await updateRunDoCancelRequested(context, row);
    return outcome === "applied" ? expectTrusted(RunId, row.runId, "RunId") : null;
  } catch (error) {
    context.logger.error("cancel_requested_run_do_sync_failed", {
      projectId,
      runId: row.runId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
};

export const dispatchExecutableRun = async (context: ProjectDoContext, projectId: ProjectId): Promise<RunId | null> => {
  const row = await getNextDispatchableRun(context, projectId);
  if (!row) {
    await reconcileQueuedWorkflowRun(context, projectId);
    return null;
  }

  const runId = expectTrusted(RunId, row.runId, "RunId");
  const retryAt = await getDispatchRetryAt(context, runId);
  if (retryAt !== null && retryAt > Date.now()) {
    return null;
  }

  const dispatchMode = expectTrusted(DispatchMode, row.dispatchMode, "DispatchMode");

  try {
    if (dispatchMode === "workflows" && !markWorkflowRunQueued(context, projectId, runId)) {
      return null;
    }

    await dispatchRun(context, projectId, runId, dispatchMode, getSnapshot(row));

    if (dispatchMode === "queue") {
      context.db.transaction((tx) => {
        const currentRow = getRunRow(tx, projectId, runId);
        if (!currentRow || currentRow.status !== "executable" || currentRow.dispatchStatus !== "pending") {
          return;
        }

        tx.update(projectSchema.projectRuns)
          .set({
            dispatchStatus: "queued",
            lastError: null,
          })
          .where(eq(projectSchema.projectRuns.runId, currentRow.runId))
          .run();
      });
      await setDispatchRetryAt(context, runId, null);
      return runId;
    }

    const completionState = getWorkflowDispatchCompletionState(context, projectId, runId);
    if (completionState !== "rearmed") {
      await setDispatchRetryAt(context, runId, null);
    }

    return completionState === "rearmed" ? null : runId;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const failureKind = await applyDispatchFailure(
      context,
      projectId,
      runId,
      dispatchMode,
      row.dispatchAttempts,
      errorMessage,
    );
    return failureKind === "terminal" && dispatchMode === "queue" ? runId : null;
  }
};
