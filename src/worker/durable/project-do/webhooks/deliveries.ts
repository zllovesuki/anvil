import { BranchName, CommitSha, DispatchMode, ExecutionRuntime, RunId, UnixTimestampMs } from "@/contracts";
import {
  type EnsureRunInput,
  type AcceptQueuedRunInput,
  type RecordVerifiedWebhookDeliveryInput,
  type RecordVerifiedWebhookDeliveryResult,
  expectTrusted,
  nullableTrusted,
} from "@/worker/contracts";
import * as projectSchema from "@/worker/db/durable/schema/project-do";
import { getProjectConfigRow } from "../repo";
import { ensureRunInitializedWithPayload } from "../run-do-sync";
import { rescheduleAlarmInTransaction } from "../sidecar-state";
import { ensureProjectState, transitionAcceptQueuedRun } from "../transitions";
import type { ProjectDoContext, ProjectStore } from "../types";
import { WEBHOOK_DELIVERY_RETENTION_MS, type ParsedWebhookDeliveryRow, type StoredWebhookReplayResult } from "./types";
import {
  getWebhookDeliveryRow,
  getProjectWebhookRow,
  parseWebhookDeliveryRow,
  pruneWebhookDeliveries,
  updateWebhookDeliveryRow,
} from "./repo";
interface AcceptedMutationResult {
  outcome: "accepted" | "queue_full";
  duplicate: boolean;
  runId: RecordVerifiedWebhookDeliveryResult["runId"];
  queuedAt: RecordVerifiedWebhookDeliveryResult["queuedAt"];
  executable: RecordVerifiedWebhookDeliveryResult["executable"];
  staleVerification: false;
  runInitialization: EnsureRunInput | null;
}
interface StaleVerificationMutationResult {
  outcome: RecordVerifiedWebhookDeliveryResult["outcome"];
  duplicate: false;
  runId: null;
  queuedAt: null;
  executable: null;
  staleVerification: true;
  runInitialization: null;
}
interface PreparedWebhookDeliveryMutation {
  existingRow: typeof projectSchema.projectWebhookDeliveries.$inferSelect | undefined;
  replay: StoredWebhookReplayResult | null;
}
const isWebhookVerificationStillCurrent = (tx: ProjectStore, input: RecordVerifiedWebhookDeliveryInput): boolean => {
  const webhookRow = getProjectWebhookRow(tx, input.projectId, input.payload.provider);
  return !!webhookRow && webhookRow.enabled !== 0 && webhookRow.updatedAt === input.verifiedWebhookUpdatedAt;
};
const toStaleVerificationResult = (
  outcome: RecordVerifiedWebhookDeliveryResult["outcome"],
): StaleVerificationMutationResult => ({
  outcome,
  duplicate: false,
  runId: null,
  queuedAt: null,
  executable: null,
  staleVerification: true,
  runInitialization: null,
});
const toReplayResult = (row: ParsedWebhookDeliveryRow): StoredWebhookReplayResult => ({
  outcome: row.outcome,
  duplicate: true,
  runId: row.runId === null ? null : expectTrusted(RunId, row.runId, "RunId"),
  queuedAt: null,
  executable: null,
  staleVerification: false,
  runInitialization: null,
  payload: {
    provider: row.provider,
    deliveryId: row.deliveryId,
    eventKind: row.eventKind,
    eventName: row.eventName,
    repoUrl: row.repoUrl,
    ref: row.ref,
    branch: nullableTrusted(BranchName, row.branch, "BranchName"),
    commitSha: nullableTrusted(CommitSha, row.commitSha, "CommitSha"),
    beforeSha: nullableTrusted(CommitSha, row.beforeSha, "CommitSha"),
  },
});
const insertWebhookDeliveryRow = (
  tx: ProjectStore,
  input: RecordVerifiedWebhookDeliveryInput,
  outcome: RecordVerifiedWebhookDeliveryResult["outcome"],
  runId: string | null,
  receivedAt: number,
): void => {
  tx.insert(projectSchema.projectWebhookDeliveries)
    .values({
      id: crypto.randomUUID(),
      projectId: input.projectId,
      provider: input.payload.provider,
      deliveryId: input.payload.deliveryId,
      eventKind: input.payload.eventKind,
      eventName: input.payload.eventName,
      outcome,
      repoUrl: input.payload.repoUrl,
      ref: input.payload.ref,
      branch: input.payload.branch,
      commitSha: input.payload.commitSha,
      beforeSha: input.payload.beforeSha,
      runId,
      receivedAt,
    })
    .run();
};
const persistWebhookDeliveryRow = (
  tx: ProjectStore,
  existingRow: typeof projectSchema.projectWebhookDeliveries.$inferSelect | undefined,
  input: RecordVerifiedWebhookDeliveryInput,
  outcome: RecordVerifiedWebhookDeliveryResult["outcome"],
  runId: string | null,
  receivedAt: number,
): void => {
  if (existingRow) {
    updateWebhookDeliveryRow(tx, existingRow.id, input, outcome, runId, receivedAt);
    return;
  }
  insertWebhookDeliveryRow(tx, input, outcome, runId, receivedAt);
};
const prepareWebhookDeliveryMutation = (
  context: ProjectDoContext,
  tx: ProjectStore,
  input: RecordVerifiedWebhookDeliveryInput,
  currentTime: number,
): PreparedWebhookDeliveryMutation | StaleVerificationMutationResult => {
  ensureProjectState(context, tx, input.projectId);
  if (!isWebhookVerificationStillCurrent(tx, input)) {
    return toStaleVerificationResult(input.outcome);
  }
  pruneWebhookDeliveries(tx, input.projectId, currentTime - WEBHOOK_DELIVERY_RETENTION_MS);
  const existingRow = getWebhookDeliveryRow(tx, input.projectId, input.payload.provider, input.payload.deliveryId);
  if (!existingRow) {
    return {
      existingRow: undefined,
      replay: null,
    };
  }
  return {
    existingRow,
    replay: toReplayResult(parseWebhookDeliveryRow(existingRow)),
  };
};
const toDuplicateDeliveryResult = (
  replay: StoredWebhookReplayResult,
): Omit<RecordVerifiedWebhookDeliveryResult, "queuedAt" | "executable" | "staleVerification"> & {
  queuedAt: null;
  executable: null;
  staleVerification: false;
} => ({
  outcome: replay.outcome,
  duplicate: true,
  runId: replay.runId,
  queuedAt: null,
  executable: null,
  staleVerification: false,
});
const runAcceptedWebhookMutation = async (
  context: ProjectDoContext,
  input: RecordVerifiedWebhookDeliveryInput,
  currentTime: number,
): Promise<RecordVerifiedWebhookDeliveryResult> => {
  const branch = input.payload.branch;
  if (branch === null) {
    throw new Error(`Accepted webhook delivery ${input.payload.deliveryId} is missing a branch.`);
  }
  const transition = await context.ctx.storage.transaction(
    async (txn): Promise<StoredWebhookReplayResult | AcceptedMutationResult | StaleVerificationMutationResult> => {
      const prepared = prepareWebhookDeliveryMutation(context, context.db, input, currentTime);
      if ("staleVerification" in prepared) {
        return prepared;
      }
      const { existingRow, replay } = prepared;
      if (replay) {
        // queue_full is the only retryable delivery state. Providers resend the
        // same delivery id, and anvil does not retry internally, so a prior
        // queue_full row must be reprocessed until it settles to a terminal state.
        if (replay.outcome !== "queue_full") {
          return replay;
        }
      }
      const projectConfigRow = getProjectConfigRow(context.db, input.projectId);
      if (!projectConfigRow) {
        throw new Error(`Project config ${input.projectId} is missing during webhook acceptance.`);
      }
      const acceptInput: AcceptQueuedRunInput = {
        projectId: input.projectId,
        triggerType: "webhook",
        triggeredByUserId: null,
        branch,
        commitSha: input.payload.commitSha,
        repoUrl: projectConfigRow.repoUrl,
        configPath: projectConfigRow.configPath,
        provider: input.payload.provider,
        deliveryId: input.payload.deliveryId,
        dispatchMode: expectTrusted(DispatchMode, projectConfigRow.dispatchMode, "DispatchMode"),
        executionRuntime: expectTrusted(ExecutionRuntime, projectConfigRow.executionRuntime, "ExecutionRuntime"),
      };
      const accepted = transitionAcceptQueuedRun(context, context.db, acceptInput, currentTime);
      if (accepted.kind === "rejected") {
        persistWebhookDeliveryRow(context.db, existingRow, input, "queue_full", null, currentTime);
        return {
          outcome: "queue_full" as const,
          duplicate: false,
          runId: null,
          queuedAt: null,
          executable: null,
          staleVerification: false,
          runInitialization: null,
        };
      }
      persistWebhookDeliveryRow(context.db, existingRow, input, "accepted", accepted.runId, currentTime);
      await rescheduleAlarmInTransaction(context, txn, input.projectId);
      return {
        outcome: "accepted" as const,
        duplicate: false,
        runId: accepted.runId,
        queuedAt: accepted.queuedAt,
        executable: accepted.executable,
        staleVerification: false,
        runInitialization: accepted.runInitialization,
      };
    },
  );
  if (transition.duplicate || transition.runInitialization === null) {
    return {
      outcome: transition.outcome,
      duplicate: transition.duplicate,
      runId: transition.runId,
      queuedAt: transition.queuedAt,
      executable: transition.executable,
      staleVerification: transition.staleVerification,
    };
  }
  try {
    await ensureRunInitializedWithPayload(context, transition.runInitialization);
  } catch (error) {
    context.logger.error("webhook_run_do_initialize_failed", {
      projectId: input.projectId,
      runId: transition.runId,
      provider: input.payload.provider,
      deliveryId: input.payload.deliveryId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return {
    outcome: transition.outcome,
    duplicate: false,
    runId: transition.runId,
    queuedAt: transition.queuedAt,
    executable: transition.executable,
    staleVerification: false,
  };
};
export const recordVerifiedWebhookDelivery = async (
  context: ProjectDoContext,
  input: RecordVerifiedWebhookDeliveryInput,
): Promise<RecordVerifiedWebhookDeliveryResult> => {
  const currentTime = expectTrusted(UnixTimestampMs, Date.now(), "UnixTimestampMs");
  if (input.outcome === "accepted") {
    return await runAcceptedWebhookMutation(context, input, currentTime);
  }
  return context.db.transaction((tx) => {
    const prepared = prepareWebhookDeliveryMutation(context, tx, input, currentTime);
    if ("staleVerification" in prepared) {
      return prepared;
    }
    if (prepared.replay) {
      // Only the accepted path is allowed to retry a prior queue_full row.
      // If this resend now classifies as a non-accepted outcome, replay the
      // stored queue_full result instead of mutating durable audit history.
      return toDuplicateDeliveryResult(prepared.replay);
    }
    persistWebhookDeliveryRow(tx, prepared.existingRow, input, input.outcome, null, currentTime);
    return {
      outcome: input.outcome,
      duplicate: false,
      runId: null,
      queuedAt: null,
      executable: null,
      staleVerification: false,
    };
  });
};
