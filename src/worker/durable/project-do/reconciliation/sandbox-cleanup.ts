import { asc, eq } from "drizzle-orm";

import { type ProjectId, RunId } from "@/contracts";
import { expectTrusted } from "@/worker/contracts";
import * as projectSchema from "@/worker/db/durable/schema/project-do";
import { isNoContainerInstanceError } from "@/worker/sandbox/container-errors";

import { SANDBOX_CLEANUP_RETRY_DELAYS_MS } from "../constants";
import { getSandboxCleanupRetryState, rescheduleAlarmInTransaction, sandboxCleanupRetryKey } from "../sidecar-state";
import type { ProjectDoContext, SandboxCleanupRetryState } from "../types";

const buildRetryState = (attempt: number): SandboxCleanupRetryState => ({
  attempt,
  nextAt:
    Date.now() + SANDBOX_CLEANUP_RETRY_DELAYS_MS[Math.min(attempt - 1, SANDBOX_CLEANUP_RETRY_DELAYS_MS.length - 1)],
});

export const persistSandboxCleanupRetryState = async (
  context: ProjectDoContext,
  projectId: ProjectId,
  runId: RunId,
  value: SandboxCleanupRetryState | null,
): Promise<void> => {
  await context.ctx.storage.transaction(async (txn) => {
    if (value === null) {
      await txn.delete(sandboxCleanupRetryKey(runId));
    } else {
      await txn.put(sandboxCleanupRetryKey(runId), value);
    }

    await rescheduleAlarmInTransaction(context, txn, projectId);
  });
};

export const seedSandboxCleanupRetry = async (
  context: ProjectDoContext,
  projectId: ProjectId,
  runId: RunId,
): Promise<void> => {
  await persistSandboxCleanupRetryState(context, projectId, runId, buildRetryState(1));
};

export const clearSandboxCleanupRetry = async (
  context: ProjectDoContext,
  projectId: ProjectId,
  runId: RunId,
): Promise<void> => {
  await persistSandboxCleanupRetryState(context, projectId, runId, null);
};

export const attemptSandboxCleanup = async (
  context: ProjectDoContext,
  projectId: ProjectId,
  runId: RunId,
  trigger: "alarm" | "watchdog",
): Promise<boolean> => {
  const sandboxStub = context.env.Sandbox.getByName(runId);

  try {
    await sandboxStub.setKeepAlive(false);
  } catch (error) {
    context.logger.warn("sandbox_keep_alive_release_failed", {
      projectId,
      runId,
      trigger,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    await sandboxStub.destroy();
    return true;
  } catch (error) {
    if (isNoContainerInstanceError(error)) {
      return true;
    }

    context.logger.warn("sandbox_destroy_failed", {
      projectId,
      runId,
      trigger,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
};

export const reconcileSandboxCleanup = async (
  context: ProjectDoContext,
  projectId: ProjectId,
): Promise<RunId | null> => {
  const rows = await context.db
    .select({
      runId: projectSchema.projectRuns.runId,
    })
    .from(projectSchema.projectRuns)
    .where(eq(projectSchema.projectRuns.projectId, projectId))
    .orderBy(asc(projectSchema.projectRuns.createdAt), asc(projectSchema.projectRuns.runId));

  let candidateRunId: RunId | null = null;
  let retryState: SandboxCleanupRetryState | null = null;

  for (const row of rows) {
    const runId = expectTrusted(RunId, row.runId, "RunId");
    const currentRetryState = await getSandboxCleanupRetryState(context, runId);
    if (!currentRetryState || currentRetryState.nextAt > Date.now()) {
      continue;
    }

    candidateRunId = runId;
    retryState = currentRetryState;
    break;
  }

  if (!candidateRunId || !retryState) {
    return null;
  }

  if (await attemptSandboxCleanup(context, projectId, candidateRunId, "alarm")) {
    await clearSandboxCleanupRetry(context, projectId, candidateRunId);
    return candidateRunId;
  }

  const nextRetryState = buildRetryState(retryState.attempt + 1);
  await persistSandboxCleanupRetryState(context, projectId, candidateRunId, nextRetryState);
  context.logger.warn("sandbox_cleanup_retry_scheduled", {
    projectId,
    runId: candidateRunId,
    attempt: nextRetryState.attempt,
    nextAt: nextRetryState.nextAt,
  });
  return null;
};
