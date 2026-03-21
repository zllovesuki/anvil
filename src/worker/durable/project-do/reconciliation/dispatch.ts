import { eq } from "drizzle-orm";

import { DispatchMode, type ProjectId, RunId } from "@/contracts";
import { D1SyncStatus, expectTrusted } from "@/worker/contracts";
import * as projectSchema from "@/worker/db/durable/schema/project-do";

import { DISPATCH_RETRY_DELAYS_MS } from "../constants";
import { getNextDispatchableRun, getOldestCancelRequestedRun, getRunRow } from "../repo";
import { setRunDoTerminal, updateRunDoCancelRequested } from "../run-do-sync";
import { getDispatchRetryAt, setDispatchRetryAt } from "../sidecar-state";
import { dispatchRun } from "./dispatch-helper";
import { getRetryDelay } from "./shared";
import { nextTerminalD1SyncStatus, promoteNextPendingRun } from "../transitions/shared";
import type { ProjectDoContext } from "../types";

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
    return null;
  }

  const runId = expectTrusted(RunId, row.runId, "RunId");
  const retryAt = await getDispatchRetryAt(context, runId);
  if (retryAt !== null && retryAt > Date.now()) {
    return null;
  }

  const dispatchMode = expectTrusted(DispatchMode, row.dispatchMode, "DispatchMode");

  try {
    await dispatchRun(context, projectId, runId, dispatchMode);

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
  } catch (error) {
    const nextAttempt = row.dispatchAttempts + 1;

    if (nextAttempt > DISPATCH_RETRY_DELAYS_MS.length) {
      await context.db.transaction((tx) => {
        const currentRow = getRunRow(tx, projectId, runId);
        if (!currentRow || currentRow.status !== "executable") {
          return;
        }

        tx.update(projectSchema.projectRuns)
          .set({
            status: "failed",
            position: null,
            dispatchStatus: "terminal",
            dispatchAttempts: nextAttempt,
            d1SyncStatus: nextTerminalD1SyncStatus(
              expectTrusted(D1SyncStatus, currentRow.d1SyncStatus, "D1SyncStatus"),
            ),
            lastError: "dispatch_failed",
          })
          .where(eq(projectSchema.projectRuns.runId, currentRow.runId))
          .run();
        promoteNextPendingRun(tx, projectId);
      });

      await setDispatchRetryAt(context, runId, null);
      try {
        await setRunDoTerminal(context, row, "failed", "dispatch_failed");
      } catch (runDoError) {
        context.logger.error("dispatch_failed_run_do_terminalize_failed", {
          projectId,
          runId,
          error: runDoError instanceof Error ? runDoError.message : String(runDoError),
        });
      }
      return runId;
    }

    const nextAt = Date.now() + getRetryDelay(nextAttempt, DISPATCH_RETRY_DELAYS_MS);
    await context.db
      .update(projectSchema.projectRuns)
      .set({
        dispatchAttempts: nextAttempt,
        lastError: error instanceof Error ? error.message : String(error),
      })
      .where(eq(projectSchema.projectRuns.runId, row.runId));
    await setDispatchRetryAt(context, runId, nextAt);
    context.logger.error("run_dispatch_failed", {
      projectId,
      runId,
      attempt: nextAttempt,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
};
