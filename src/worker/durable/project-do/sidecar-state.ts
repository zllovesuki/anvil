import { type ProjectId, RunId } from "@/contracts";
import { expectTrusted } from "@/worker/contracts";

import {
  CANCEL_RECONCILE_RETRY_MS,
  HEARTBEAT_STALE_AFTER_MS,
  PROJECT_RECONCILIATION_LIVENESS_FALLBACK_MS,
} from "./constants";
import { getProjectState, listProjectRuns } from "./repo";
import { isTerminalStatus } from "./transitions";
import type {
  D1RetryPhase,
  D1RetryState,
  ProjectDoContext,
  ProjectIndexRetryState,
  SandboxCleanupRetryState,
} from "./types";

type SidecarStorage = Pick<DurableObjectStorage, "get" | "getAlarm" | "setAlarm" | "deleteAlarm">;

export const dispatchRetryKey = (runId: RunId): string => `run:${runId}:dispatch-retry-at`;

export const d1RetryKey = (runId: RunId): string => `run:${runId}:d1-retry`;

export const heartbeatKey = (runId: RunId): string => `run:${runId}:heartbeat-at`;
export const sandboxCleanupRetryKey = (runId: RunId): string => `run:${runId}:sandbox-cleanup-retry`;

export const projectIndexRetryKey = (): string => "project:index-sync-retry";

const isD1RetryPhase = (value: unknown): value is D1RetryPhase =>
  value === "create" || value === "metadata" || value === "terminal";

const isProjectIndexRetryPhase = (value: unknown): value is "project_index" => value === "project_index";

export const getD1RetryAtForPhase = (retryState: D1RetryState | null, phase: D1RetryPhase): number | null => {
  if (!retryState) {
    return null;
  }

  return retryState.phase === phase ? retryState.nextAt : null;
};

export const shouldWaitForD1Retry = (retryState: D1RetryState | null, phase: D1RetryPhase): boolean => {
  const retryAt = getD1RetryAtForPhase(retryState, phase);
  return retryAt !== null && retryAt > Date.now();
};

const getDispatchRetryAtFromStorage = async (
  storage: Pick<DurableObjectStorage, "get">,
  runId: RunId,
): Promise<number | null> => {
  const value = await storage.get<number>(dispatchRetryKey(runId));
  return typeof value === "number" ? value : null;
};

export const getDispatchRetryAt = async (context: ProjectDoContext, runId: RunId): Promise<number | null> =>
  getDispatchRetryAtFromStorage(context.ctx.storage, runId);

export const setDispatchRetryAt = async (
  context: ProjectDoContext,
  runId: RunId,
  value: number | null,
): Promise<void> => {
  if (value === null) {
    await context.ctx.storage.delete(dispatchRetryKey(runId));
    return;
  }

  await context.ctx.storage.put(dispatchRetryKey(runId), value);
};

const getD1RetryStateFromStorage = async (
  storage: Pick<DurableObjectStorage, "get">,
  runId: RunId,
): Promise<D1RetryState | null> => {
  const value = await storage.get<D1RetryState>(d1RetryKey(runId));
  if (!value || typeof value !== "object") {
    return null;
  }

  if (!("attempt" in value) || !("nextAt" in value)) {
    return null;
  }

  if (!("phase" in value) || !isD1RetryPhase(value.phase)) {
    return null;
  }

  return {
    attempt: Number(value.attempt),
    nextAt: Number(value.nextAt),
    phase: value.phase,
  };
};

export const getD1RetryState = async (context: ProjectDoContext, runId: RunId): Promise<D1RetryState | null> =>
  getD1RetryStateFromStorage(context.ctx.storage, runId);

export const setD1RetryState = async (
  context: ProjectDoContext,
  runId: RunId,
  value: D1RetryState | null,
): Promise<void> => {
  if (value === null) {
    await context.ctx.storage.delete(d1RetryKey(runId));
    return;
  }

  await context.ctx.storage.put(d1RetryKey(runId), value);
};

const getProjectIndexRetryStateFromStorage = async (
  storage: Pick<DurableObjectStorage, "get">,
): Promise<ProjectIndexRetryState | null> => {
  const value = await storage.get<ProjectIndexRetryState>(projectIndexRetryKey());
  if (!value || typeof value !== "object") {
    return null;
  }

  if (!("attempt" in value) || !("nextAt" in value)) {
    return null;
  }

  if (!("phase" in value) || !isProjectIndexRetryPhase(value.phase)) {
    return null;
  }

  return {
    attempt: Number(value.attempt),
    nextAt: Number(value.nextAt),
    phase: "project_index",
  };
};

export const getProjectIndexRetryState = async (context: ProjectDoContext): Promise<ProjectIndexRetryState | null> =>
  getProjectIndexRetryStateFromStorage(context.ctx.storage);

export const setProjectIndexRetryState = async (
  context: ProjectDoContext,
  value: ProjectIndexRetryState | null,
): Promise<void> => {
  if (value === null) {
    await context.ctx.storage.delete(projectIndexRetryKey());
    return;
  }

  await context.ctx.storage.put(projectIndexRetryKey(), value);
};

const getHeartbeatAtFromStorage = async (
  storage: Pick<DurableObjectStorage, "get">,
  runId: RunId,
): Promise<number | null> => {
  const value = await storage.get<number>(heartbeatKey(runId));
  return typeof value === "number" ? value : null;
};

export const getHeartbeatAt = async (context: ProjectDoContext, runId: RunId): Promise<number | null> =>
  getHeartbeatAtFromStorage(context.ctx.storage, runId);

export const setHeartbeatAt = async (context: ProjectDoContext, runId: RunId, value: number | null): Promise<void> => {
  if (value === null) {
    await context.ctx.storage.delete(heartbeatKey(runId));
    return;
  }

  await context.ctx.storage.put(heartbeatKey(runId), value);
};

const getSandboxCleanupRetryStateFromStorage = async (
  storage: Pick<DurableObjectStorage, "get">,
  runId: RunId,
): Promise<SandboxCleanupRetryState | null> => {
  const value = await storage.get<SandboxCleanupRetryState>(sandboxCleanupRetryKey(runId));
  if (!value || typeof value !== "object") {
    return null;
  }

  if (!("attempt" in value) || !("nextAt" in value)) {
    return null;
  }

  return {
    attempt: Number(value.attempt),
    nextAt: Number(value.nextAt),
  };
};

export const getSandboxCleanupRetryState = async (
  context: ProjectDoContext,
  runId: RunId,
): Promise<SandboxCleanupRetryState | null> => getSandboxCleanupRetryStateFromStorage(context.ctx.storage, runId);

export const setSandboxCleanupRetryState = async (
  context: ProjectDoContext,
  runId: RunId,
  value: SandboxCleanupRetryState | null,
): Promise<void> => {
  if (value === null) {
    await context.ctx.storage.delete(sandboxCleanupRetryKey(runId));
    return;
  }

  await context.ctx.storage.put(sandboxCleanupRetryKey(runId), value);
};

const scheduleAlarmAtOnStorage = async (
  storage: Pick<DurableObjectStorage, "getAlarm" | "setAlarm" | "deleteAlarm">,
  timestamp: number | null,
): Promise<void> => {
  if (timestamp === null) {
    await storage.deleteAlarm();
    return;
  }

  const existing = await storage.getAlarm();
  const currentTime = Date.now();
  const nextTimestamp = timestamp <= currentTime ? currentTime : timestamp;

  // Wrangler local dev can preserve a past-due alarm timestamp across restarts without
  // delivering it. Treat overdue alarms as stale and re-arm them so reconciliation resumes.
  if (existing === null || existing <= currentTime || nextTimestamp < existing) {
    await storage.setAlarm(nextTimestamp);
  }
};

export const scheduleAlarmAt = async (context: ProjectDoContext, timestamp: number | null): Promise<void> => {
  await scheduleAlarmAtOnStorage(context.ctx.storage, timestamp);
};

export const scheduleImmediateReconciliation = async (context: ProjectDoContext): Promise<void> => {
  await scheduleAlarmAt(context, Date.now());
};

export const armReconciliation = async (context: ProjectDoContext, projectId: ProjectId): Promise<void> => {
  try {
    await rescheduleAlarm(context, projectId);
  } catch (error) {
    context.logger.error("project_reconciliation_arm_failed", {
      projectId,
      error: error instanceof Error ? error.message : String(error),
    });

    try {
      await context.ctx.storage.setAlarm(Date.now());
    } catch (fallbackError) {
      context.logger.error("project_reconciliation_fallback_arm_failed", {
        projectId,
        error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
      });
    }
  }
};

const computeNextAlarmAt = async (
  context: ProjectDoContext,
  storage: SidecarStorage,
  projectId: ProjectId,
): Promise<number | null> => {
  const stateRow = await getProjectState(context, projectId);
  const rows = await listProjectRuns(context, projectId);
  const currentTime = Date.now();
  let nextAt: number | null = null;
  const hasNonTerminalRows = rows.some((row) => !isTerminalStatus(row.status));

  const consider = (candidate: number): void => {
    nextAt = nextAt === null ? candidate : Math.min(nextAt, candidate);
  };

  if (stateRow?.activeRunId) {
    const activeRunId = expectTrusted(RunId, stateRow.activeRunId, "RunId");
    const heartbeatAt = await getHeartbeatAtFromStorage(storage, activeRunId);
    // If claimRunWork() committed but the sidecar heartbeat write has not happened yet,
    // fall back to the active-claim timestamp instead of treating the run as stale immediately.
    consider((heartbeatAt ?? stateRow.updatedAt) + HEARTBEAT_STALE_AFTER_MS);
  }

  if (rows.some((row) => row.status === "cancel_requested")) {
    consider(currentTime + CANCEL_RECONCILE_RETRY_MS);
  }

  if (stateRow?.projectIndexSyncStatus === "needs_update") {
    consider((await getProjectIndexRetryStateFromStorage(storage))?.nextAt ?? currentTime);
  }

  const hasExecutable = rows.some((row) => row.status === "executable");
  const hasPending = rows.some((row) => row.status === "pending");
  if (!stateRow?.activeRunId && !hasExecutable && hasPending) {
    consider(currentTime);
  }

  for (const row of rows) {
    const runId = expectTrusted(RunId, row.runId, "RunId");
    const sandboxCleanupRetryState = await getSandboxCleanupRetryStateFromStorage(storage, runId);

    if (sandboxCleanupRetryState) {
      consider(sandboxCleanupRetryState.nextAt);
    }

    if (row.status === "executable" && row.dispatchStatus === "pending") {
      consider((await getDispatchRetryAtFromStorage(storage, runId)) ?? currentTime);
    }

    if (
      row.d1SyncStatus === "needs_create" ||
      row.d1SyncStatus === "needs_update" ||
      row.d1SyncStatus === "needs_terminal_update"
    ) {
      const phase: D1RetryPhase =
        row.d1SyncStatus === "needs_create" ? "create" : row.d1SyncStatus === "needs_update" ? "metadata" : "terminal";
      consider(getD1RetryAtForPhase(await getD1RetryStateFromStorage(storage, runId), phase) ?? currentTime);
    }
  }

  if (nextAt === null && hasNonTerminalRows) {
    consider(currentTime + PROJECT_RECONCILIATION_LIVENESS_FALLBACK_MS);
  }

  return nextAt;
};

export const rescheduleAlarmInTransaction = async (
  context: ProjectDoContext,
  txn: DurableObjectTransaction,
  projectId: ProjectId,
): Promise<void> => {
  const nextAt = await computeNextAlarmAt(context, txn, projectId);
  await scheduleAlarmAtOnStorage(txn, nextAt);
};

export const rescheduleAlarm = async (context: ProjectDoContext, projectId: ProjectId): Promise<void> => {
  const nextAt = await computeNextAlarmAt(context, context.ctx.storage, projectId);
  await scheduleAlarmAtOnStorage(context.ctx.storage, nextAt);
};
