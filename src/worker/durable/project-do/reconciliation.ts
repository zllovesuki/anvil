import type { ProjectId, RunId } from "@/contracts";
import {
  dispatchExecutableRun,
  reconcileCancelRequestedRunDo,
  reconcileAcceptedRunD1Sync,
  reconcileProjectIndexReplicaSync,
  reconcileRunMetadataD1Sync,
  reconcileSandboxCleanup,
  reconcileTerminalRunD1Sync,
  syncRunMetadataToD1,
  promotePendingRun,
  reconcileActiveRunWatchdog,
} from "./reconciliation/index";
import type { ProjectDoContext } from "./types";
export interface AlarmCycleProgress {
  action:
    | "project_index_sync"
    | "watchdog_recovery"
    | "sandbox_cleanup"
    | "cancel_sync"
    | "promote_pending"
    | "d1_create_sync"
    | "d1_metadata_sync"
    | "d1_terminal_sync"
    | "dispatch_enqueue";
  runId: RunId | null;
}
export {
  dispatchExecutableRun,
  reconcileAcceptedRunD1Sync,
  reconcileActiveRunWatchdog,
  reconcileCancelRequestedRunDo,
  reconcileProjectIndexReplicaSync,
  reconcileRunMetadataD1Sync,
  reconcileSandboxCleanup,
  reconcileTerminalRunD1Sync,
  syncRunMetadataToD1,
};
export const runAlarmCycle = async (
  context: ProjectDoContext,
  projectId: ProjectId,
): Promise<AlarmCycleProgress | null> => {
  const projectIndexSynced = await reconcileProjectIndexReplicaSync(context, projectId);
  if (projectIndexSynced) {
    return {
      action: "project_index_sync",
      runId: null,
    };
  }
  const watchdogRunId = await reconcileActiveRunWatchdog(context, projectId);
  if (watchdogRunId) {
    return {
      action: "watchdog_recovery",
      runId: watchdogRunId,
    };
  }
  const sandboxCleanupRunId = await reconcileSandboxCleanup(context, projectId);
  if (sandboxCleanupRunId) {
    return {
      action: "sandbox_cleanup",
      runId: sandboxCleanupRunId,
    };
  }
  const cancelSyncRunId = await reconcileCancelRequestedRunDo(context, projectId);
  if (cancelSyncRunId) {
    return {
      action: "cancel_sync",
      runId: cancelSyncRunId,
    };
  }
  const promotedRunId = promotePendingRun(context, projectId);
  if (promotedRunId) {
    return {
      action: "promote_pending",
      runId: promotedRunId,
    };
  }
  const d1CreateRunId = await reconcileAcceptedRunD1Sync(context, projectId);
  if (d1CreateRunId) {
    return {
      action: "d1_create_sync",
      runId: d1CreateRunId,
    };
  }
  const d1MetadataRunId = await reconcileRunMetadataD1Sync(context, projectId);
  if (d1MetadataRunId) {
    return {
      action: "d1_metadata_sync",
      runId: d1MetadataRunId,
    };
  }
  const d1TerminalRunId = await reconcileTerminalRunD1Sync(context, projectId);
  if (d1TerminalRunId) {
    return {
      action: "d1_terminal_sync",
      runId: d1TerminalRunId,
    };
  }
  const dispatchedRunId = await dispatchExecutableRun(context, projectId);
  if (dispatchedRunId) {
    return {
      action: "dispatch_enqueue",
      runId: dispatchedRunId,
    };
  }
  return null;
};
