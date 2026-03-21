import { eq } from "drizzle-orm";

import { RunId } from "@/contracts";
import { isTerminalStatus, type EnsureRunInput, type RunMetaState, type UpdateRunStateInput } from "@/worker/contracts";
import * as runSchema from "@/worker/db/durable/schema/run-do";

import { type RunDb, type TryUpdateRunStateResult, toRunMetaState } from "./core";
import { resolveRunStateUpdate, RunStateTransitionError } from "../state";

export const getRunMeta = async (db: RunDb, runId: RunId): Promise<RunMetaState | null> => {
  const rows = await db.select().from(runSchema.runMeta).where(eq(runSchema.runMeta.id, runId)).limit(1);
  if (rows.length === 0) {
    return null;
  }

  return toRunMetaState(rows[0]);
};

export const ensureInitialized = async (db: RunDb, input: EnsureRunInput): Promise<void> => {
  const payload = input;
  const existing = await getRunMeta(db, payload.runId);
  if (existing) {
    if (
      existing.projectId !== payload.projectId ||
      existing.triggerType !== payload.triggerType ||
      existing.branch !== payload.branch
    ) {
      throw new Error(`Run ${payload.runId} is already initialized with different immutable fields.`);
    }

    if (existing.commitSha === payload.commitSha) {
      return;
    }

    if (existing.commitSha === null && payload.commitSha !== null) {
      await db
        .update(runSchema.runMeta)
        .set({ commitSha: payload.commitSha })
        .where(eq(runSchema.runMeta.id, payload.runId));
      return;
    }

    if (existing.commitSha !== null && payload.commitSha === null) {
      return;
    }

    if (existing.commitSha !== payload.commitSha) {
      throw new Error(`Run ${payload.runId} is already initialized with different immutable fields.`);
    }

    return;
  }

  await db.insert(runSchema.runMeta).values({
    id: payload.runId,
    projectId: payload.projectId,
    status: "queued",
    triggerType: payload.triggerType,
    branch: payload.branch,
    commitSha: payload.commitSha,
    currentStep: null,
    startedAt: null,
    finishedAt: null,
    exitCode: null,
    errorMessage: null,
  });
};

export const updateRunState = async (db: RunDb, input: UpdateRunStateInput): Promise<void> => {
  const payload = input;
  const current = await getRunMeta(db, payload.runId);
  if (!current) {
    throw new Error(`Run ${payload.runId} is not initialized.`);
  }

  await db
    .update(runSchema.runMeta)
    .set(resolveRunStateUpdate(current, payload))
    .where(eq(runSchema.runMeta.id, payload.runId));
};

export const tryUpdateRunState = async (db: RunDb, input: UpdateRunStateInput): Promise<TryUpdateRunStateResult> => {
  const payload = input;
  const current = await getRunMeta(db, payload.runId);
  if (!current) {
    throw new Error(`Run ${payload.runId} is not initialized.`);
  }

  try {
    const resolved = resolveRunStateUpdate(current, payload);
    await db.update(runSchema.runMeta).set(resolved).where(eq(runSchema.runMeta.id, payload.runId));

    return {
      kind: "applied",
      state: {
        ...current,
        status: resolved.status,
        currentStep: resolved.currentStep === undefined ? current.currentStep : resolved.currentStep,
        startedAt: resolved.startedAt,
        finishedAt: resolved.finishedAt,
        exitCode: resolved.exitCode === undefined ? current.exitCode : resolved.exitCode,
        errorMessage: resolved.errorMessage === undefined ? current.errorMessage : resolved.errorMessage,
      },
    };
  } catch (error) {
    if (!(error instanceof RunStateTransitionError)) {
      throw error;
    }

    return {
      kind: "conflict",
      reason: error.reason,
      current,
    };
  }
};

export const repairTerminalState = async (db: RunDb, input: UpdateRunStateInput): Promise<void> => {
  const payload = input;
  const current = await getRunMeta(db, payload.runId);
  if (!current) {
    throw new Error(`Run ${payload.runId} is not initialized.`);
  }

  if (!isTerminalStatus(payload.status)) {
    throw new Error(`Run ${payload.runId} cannot be repaired to non-terminal status ${payload.status}.`);
  }

  const startedAt = payload.startedAt ?? current.startedAt;
  if (payload.status === "passed" && startedAt === null) {
    throw new Error(`Run ${payload.runId} cannot be repaired to terminal status ${payload.status} without startedAt.`);
  }

  const finishedAt = payload.finishedAt ?? current.finishedAt;
  if (finishedAt === null) {
    throw new Error(`Run ${payload.runId} cannot be repaired to terminal status ${payload.status} without finishedAt.`);
  }

  await db
    .update(runSchema.runMeta)
    .set({
      status: payload.status,
      currentStep: payload.currentStep ?? null,
      startedAt,
      finishedAt,
      exitCode: payload.exitCode,
      errorMessage: payload.errorMessage,
    })
    .where(eq(runSchema.runMeta.id, payload.runId));
};

export const deleteRunData = async (db: RunDb, runId: RunId): Promise<void> => {
  await db.delete(runSchema.runLogs).where(eq(runSchema.runLogs.runId, runId));
  await db.delete(runSchema.runSteps).where(eq(runSchema.runSteps.runId, runId));
  await db.delete(runSchema.runMeta).where(eq(runSchema.runMeta.id, runId));
};
