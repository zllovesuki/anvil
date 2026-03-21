import { eq } from "drizzle-orm";

import { type ProjectId, RunId } from "@/contracts";
import { D1SyncStatus, type ProjectRunTerminalStatus, type RunMetaState, expectTrusted } from "@/worker/contracts";
import * as projectSchema from "@/worker/db/durable/schema/project-do";

import { HEARTBEAT_STALE_AFTER_MS } from "../constants";
import { getProjectState, getRunRow, getRunRowByRunId } from "../repo";
import { setRunDoTerminal } from "../run-do-sync";
import { getHeartbeatAt, setHeartbeatAt } from "../sidecar-state";
import { attemptSandboxCleanup, clearSandboxCleanupRetry, seedSandboxCleanupRetry } from "./sandbox-cleanup";
import { getRunStub } from "./shared";
import { isTerminalStatus, nextTerminalD1SyncStatus, promoteNextPendingRun } from "../transitions/shared";
import type { ProjectDoContext } from "../types";

export const reconcileActiveRunWatchdog = async (
  context: ProjectDoContext,
  projectId: ProjectId,
): Promise<RunId | null> => {
  const stateRow = await getProjectState(context, projectId);
  if (!stateRow?.activeRunId) {
    return null;
  }

  const runId = expectTrusted(RunId, stateRow.activeRunId, "RunId");
  const heartbeatAt = await getHeartbeatAt(context, runId);
  const observedAt = heartbeatAt ?? stateRow.updatedAt;
  if (observedAt + HEARTBEAT_STALE_AFTER_MS > Date.now()) {
    return null;
  }

  const runStub = getRunStub(context, runId);
  let runMeta: RunMetaState | null;
  try {
    runMeta = await runStub.getRunSummary(runId);
  } catch (error) {
    context.logger.error("watchdog_run_summary_failed", {
      projectId,
      runId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }

  const terminalStatus: ProjectRunTerminalStatus =
    runMeta && isTerminalStatus(runMeta.status) && runMeta.finishedAt !== null ? runMeta.status : "failed";
  const lastError = terminalStatus === "failed" ? (runMeta?.errorMessage ?? "runner_lost") : runMeta?.errorMessage;

  await context.db.transaction((tx) => {
    const row = getRunRow(tx, projectId, runId);
    if (!row || (row.status !== "active" && row.status !== "cancel_requested")) {
      return;
    }

    tx.update(projectSchema.projectRuns)
      .set({
        status: terminalStatus,
        position: null,
        dispatchStatus: "terminal",
        d1SyncStatus: nextTerminalD1SyncStatus(expectTrusted(D1SyncStatus, row.d1SyncStatus, "D1SyncStatus")),
        lastError: lastError ?? null,
      })
      .where(eq(projectSchema.projectRuns.runId, row.runId))
      .run();
    tx.update(projectSchema.projectState)
      .set({
        activeRunId: null,
        updatedAt: Date.now(),
      })
      .where(eq(projectSchema.projectState.projectId, projectId))
      .run();
    promoteNextPendingRun(tx, projectId);
  });

  await setHeartbeatAt(context, runId, null);
  if (!(runMeta && isTerminalStatus(runMeta.status) && runMeta.finishedAt !== null)) {
    try {
      const updatedRow = await getRunRowByRunId(context, runId);
      if (updatedRow) {
        await setRunDoTerminal(context, updatedRow, "failed", "runner_lost");
      }
    } catch (error) {
      context.logger.error("watchdog_run_do_terminalize_failed", {
        projectId,
        runId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (await attemptSandboxCleanup(context, projectId, runId, "watchdog")) {
    await clearSandboxCleanupRetry(context, projectId, runId);
  } else {
    await seedSandboxCleanupRetry(context, projectId, runId);
  }

  return runId;
};
