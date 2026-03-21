import { and, eq } from "drizzle-orm";

import {
  BranchName,
  DispatchMode,
  ExecutionRuntime,
  type ProjectId,
  RunId,
  TriggerType,
  UnixTimestampMs,
  type WebhookProvider,
} from "@/contracts";
import {
  type AcceptManualRunResult,
  type AcceptManualRunInput,
  type ClaimRunWorkInput,
  type ClaimRunWorkResult,
  nullableTrusted,
  type PendingRunState,
  type ProjectDetailState,
  ProjectRunStatus,
  type FinalizeRunExecutionInput,
  type FinalizeRunExecutionResult,
  type RecordRunResolvedCommitResult,
  type RequestRunCancelInput,
  type RecordRunResolvedCommitInput,
  type RequestRunCancelResult,
  type RunHeartbeatInput,
  type RunHeartbeatResult,
  expectTrusted,
} from "@/worker/contracts";
import * as projectSchema from "@/worker/db/durable/schema/project-do";

import { SANDBOX_CLEANUP_RETRY_DELAYS_MS } from "./constants";
import { getProjectConfigRow, listPendingProjectDetailRows } from "./repo";
import {
  getProjectConfigState,
  getProjectExecutionMaterial as getProjectExecutionMaterialState,
  getProjectWebhookIngressState as getProjectWebhookIngressStateState,
  initializeProject as initializeProjectConfig,
  updateProjectConfig as updateProjectConfigState,
} from "./project-config";
import { syncRunMetadataToD1 } from "./reconciliation/d1-sync";
import { ensureRunInitializedWithPayload, setRunDoTerminal, updateRunDoCancelRequested } from "./run-do-sync";
import {
  armReconciliation,
  rescheduleAlarmInTransaction,
  sandboxCleanupRetryKey,
  setDispatchRetryAt,
  setHeartbeatAt,
} from "./sidecar-state";
import {
  ensureProjectState,
  transitionAcceptManualRun,
  transitionClaimRunWork,
  transitionFinalizeRunExecution,
  transitionRecordRunResolvedCommit,
  transitionRequestRunCancel,
} from "./transitions";
import type {
  InitializeProjectInput,
  ProjectConfigState,
  ProjectDoContext,
  ProjectExecutionMaterial,
  ProjectWebhookIngressState,
  UpdateProjectConfigInput,
  UpdateProjectConfigResult,
} from "./types";

const now = (): UnixTimestampMs => expectTrusted(UnixTimestampMs, Date.now(), "UnixTimestampMs");
const runBestEffortSidecar = async (
  context: ProjectDoContext,
  operation: string,
  projectId: ProjectId,
  runId: RunId | null,
  effect: () => Promise<void>,
): Promise<void> => {
  try {
    await effect();
  } catch (error) {
    context.logger.warn("project_do_sidecar_write_failed", {
      operation,
      projectId,
      runId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
const runCriticalReconciliationMutation = async <T>(
  context: ProjectDoContext,
  projectId: ProjectId,
  mutation: (txn: DurableObjectTransaction) => Promise<T> | T,
): Promise<T> =>
  context.ctx.storage.transaction(async (txn) => {
    const result = await mutation(txn);
    await rescheduleAlarmInTransaction(context, txn, projectId);
    return result;
  });

// Keep these handlers aligned with the public ProjectDO RPC contract. HTTP handlers and the queue
// consumer call the shell methods by name, so this module only moves implementation behind that surface.
export const getProjectDetailState = async (
  context: ProjectDoContext,
  projectId: ProjectId,
): Promise<ProjectDetailState> => {
  context.db.transaction((tx) => {
    ensureProjectState(context, tx, projectId);
  });

  const stateRows = await context.db
    .select()
    .from(projectSchema.projectState)
    .where(eq(projectSchema.projectState.projectId, projectId))
    .limit(1);
  const pendingRows = await listPendingProjectDetailRows(context, projectId);

  const pendingRuns: PendingRunState[] = pendingRows.map((pendingRun) => ({
    runId: expectTrusted(RunId, pendingRun.runId, "RunId"),
    branch: expectTrusted(BranchName, pendingRun.branch, "BranchName"),
    queuedAt: expectTrusted(UnixTimestampMs, pendingRun.queuedAt, "UnixTimestampMs"),
  }));

  return {
    activeRunId: nullableTrusted(RunId, stateRows[0]?.activeRunId ?? null, "RunId"),
    pendingRuns,
  };
};

export const acceptManualRun = async (
  context: ProjectDoContext,
  input: AcceptManualRunInput,
): Promise<AcceptManualRunResult> => {
  const currentTime = Date.now();
  const transition = await context.ctx.storage.transaction(async (txn) => {
    const projectConfigRow = getProjectConfigRow(context.db, input.projectId);
    if (!projectConfigRow) {
      throw new Error(`Project config ${input.projectId} is missing during manual run acceptance.`);
    }

    const result = transitionAcceptManualRun(
      context,
      context.db,
      {
        projectId: input.projectId,
        triggeredByUserId: input.triggeredByUserId,
        branch: input.branch ?? expectTrusted(BranchName, projectConfigRow.defaultBranch, "BranchName"),
        repoUrl: projectConfigRow.repoUrl,
        configPath: projectConfigRow.configPath,
        dispatchMode: expectTrusted(DispatchMode, projectConfigRow.dispatchMode, "DispatchMode"),
        executionRuntime: expectTrusted(ExecutionRuntime, projectConfigRow.executionRuntime, "ExecutionRuntime"),
      },
      currentTime,
    );
    if (result.kind === "accepted") {
      await rescheduleAlarmInTransaction(context, txn, input.projectId);
    }

    return result;
  });

  if (transition.kind === "rejected") {
    return transition;
  }

  try {
    await ensureRunInitializedWithPayload(context, transition.runInitialization);
  } catch (error) {
    context.logger.error("run_do_initialize_failed", {
      projectId: input.projectId,
      runId: transition.runId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return {
    kind: "accepted",
    runId: transition.runId,
    queuedAt: transition.queuedAt,
    executable: transition.executable,
  };
};

export const claimRunWork = async (
  context: ProjectDoContext,
  input: ClaimRunWorkInput,
): Promise<ClaimRunWorkResult> => {
  const result = await runCriticalReconciliationMutation(context, input.projectId, () =>
    transitionClaimRunWork(context, context.db, input),
  );

  if (result.kind === "execute") {
    await runBestEffortSidecar(context, "set_heartbeat", input.projectId, result.snapshot.runId, async () => {
      await setHeartbeatAt(context, result.snapshot.runId, Date.now());
    });
  }

  return result;
};

export const finalizeRunExecution = async (
  context: ProjectDoContext,
  input: FinalizeRunExecutionInput,
): Promise<FinalizeRunExecutionResult> => {
  const result = await runCriticalReconciliationMutation(context, input.projectId, async (txn) => {
    const transition = transitionFinalizeRunExecution(context, context.db, input);

    if (input.sandboxDestroyed) {
      await txn.delete(sandboxCleanupRetryKey(input.runId));
    } else {
      await txn.put(sandboxCleanupRetryKey(input.runId), {
        attempt: 1,
        nextAt: Date.now() + SANDBOX_CLEANUP_RETRY_DELAYS_MS[0],
      });
    }

    return transition;
  });

  await runBestEffortSidecar(context, "clear_heartbeat", input.projectId, input.runId, async () => {
    await setHeartbeatAt(context, input.runId, null);
  });
  return result;
};

export const recordRunResolvedCommit = async (
  context: ProjectDoContext,
  input: RecordRunResolvedCommitInput,
): Promise<RecordRunResolvedCommitResult> => {
  const transition = await runCriticalReconciliationMutation(context, input.projectId, () =>
    transitionRecordRunResolvedCommit(context, context.db, input),
  );

  if (transition.kind === "stale") {
    return transition;
  }

  await syncRunMetadataToD1(context, input.projectId, input.runId, transition.row);
  return {
    kind: "applied",
  };
};

export const requestRunCancel = async (
  context: ProjectDoContext,
  input: RequestRunCancelInput,
): Promise<RequestRunCancelResult> => {
  const transition = await runCriticalReconciliationMutation(context, input.projectId, () =>
    transitionRequestRunCancel(context, context.db, input, now()),
  );

  if (transition.runDoAction === "canceled") {
    await runBestEffortSidecar(context, "clear_dispatch_retry", input.projectId, input.runId, async () => {
      await setDispatchRetryAt(context, input.runId, null);
    });
    await runBestEffortSidecar(context, "clear_heartbeat", input.projectId, input.runId, async () => {
      await setHeartbeatAt(context, input.runId, null);
    });
    try {
      await setRunDoTerminal(context, transition.row, "canceled", null);
    } catch (error) {
      context.logger.error("pending_cancel_run_do_terminalize_failed", {
        projectId: input.projectId,
        runId: input.runId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  } else if (transition.runDoAction === "cancel_requested") {
    try {
      await updateRunDoCancelRequested(context, transition.row);
    } catch (error) {
      context.logger.error("active_cancel_run_do_update_failed", {
        projectId: input.projectId,
        runId: input.runId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    runId: input.runId,
    status: transition.runStatus,
    cancelRequestedAt: transition.cancelRequestedAt,
  };
};

export const recordRunHeartbeat = async (
  context: ProjectDoContext,
  input: RunHeartbeatInput,
): Promise<RunHeartbeatResult> => {
  const row = context.db.transaction((tx) => {
    ensureProjectState(context, tx, input.projectId);
    return tx
      .select()
      .from(projectSchema.projectRuns)
      .where(
        and(eq(projectSchema.projectRuns.projectId, input.projectId), eq(projectSchema.projectRuns.runId, input.runId)),
      )
      .limit(1)
      .get();
  });
  if (!row) {
    return null;
  }

  const control = {
    runId: input.runId,
    status: expectTrusted(ProjectRunStatus, row.status, "ProjectRunStatus"),
    cancelRequestedAt: nullableTrusted(UnixTimestampMs, row.cancelRequestedAt, "UnixTimestampMs"),
  };

  if (row.status === "active" || row.status === "cancel_requested") {
    await runBestEffortSidecar(context, "set_heartbeat", input.projectId, input.runId, async () => {
      await setHeartbeatAt(context, input.runId, Date.now());
    });
    await runBestEffortSidecar(context, "arm_reconciliation", input.projectId, input.runId, async () => {
      await armReconciliation(context, input.projectId);
    });
  }

  return control;
};

export const initializeProject = async (context: ProjectDoContext, input: InitializeProjectInput): Promise<void> => {
  await initializeProjectConfig(context, input);
};

export const getProjectConfig = async (
  context: ProjectDoContext,
  projectId: ProjectId,
): Promise<ProjectConfigState | null> => {
  return await getProjectConfigState(context, projectId);
};

export const updateProjectConfig = async (
  context: ProjectDoContext,
  input: UpdateProjectConfigInput,
): Promise<UpdateProjectConfigResult> => {
  return await updateProjectConfigState(context, input);
};

export const getProjectExecutionMaterial = async (
  context: ProjectDoContext,
  projectId: ProjectId,
): Promise<ProjectExecutionMaterial | null> => {
  return await getProjectExecutionMaterialState(context, projectId);
};

export const getProjectWebhookIngressState = async (
  context: ProjectDoContext,
  projectId: ProjectId,
  provider: WebhookProvider,
): Promise<ProjectWebhookIngressState | null> => {
  return await getProjectWebhookIngressStateState(context, projectId, provider);
};
