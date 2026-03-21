import { asc, eq } from "drizzle-orm";

import { RunId } from "@/contracts";
import { type ReplaceRunStepsInput, type RunStepState, type UpdateRunStepStateInput } from "@/worker/contracts";
import * as runSchema from "@/worker/db/durable/schema/run-do";

import { assertStepTransition } from "../state";
import { chunkRows, type RunDb, type RunTx, toRunStepState } from "./core";

const MAX_SQL_BOUND_PARAMETERS = 100;
const RUN_STEP_INSERT_COLUMN_COUNT = 9;
const MAX_RUN_STEP_ROWS_PER_INSERT = Math.floor(MAX_SQL_BOUND_PARAMETERS / RUN_STEP_INSERT_COLUMN_COUNT);

export const listRunSteps = async (db: RunDb, runId: RunId): Promise<RunStepState[]> => {
  const rows = await db
    .select()
    .from(runSchema.runSteps)
    .where(eq(runSchema.runSteps.runId, runId))
    .orderBy(asc(runSchema.runSteps.position));

  return rows.map(toRunStepState);
};

export const replaceSteps = async (db: RunDb, input: ReplaceRunStepsInput): Promise<void> => {
  const payload = input;
  const stepRows = payload.steps.map((step) => ({
    id: `${payload.runId}:step:${step.position}`,
    runId: payload.runId,
    position: step.position,
    name: step.name,
    command: step.command,
    status: "queued" as const,
    startedAt: null,
    finishedAt: null,
    exitCode: null,
  }));

  db.transaction((tx: RunTx) => {
    tx.delete(runSchema.runSteps).where(eq(runSchema.runSteps.runId, payload.runId)).run();
    if (stepRows.length === 0) {
      return;
    }

    for (const batch of chunkRows(stepRows, MAX_RUN_STEP_ROWS_PER_INSERT)) {
      tx.insert(runSchema.runSteps).values(batch).run();
    }
  });
};

export const updateStepState = async (db: RunDb, input: UpdateRunStepStateInput): Promise<void> => {
  const payload = input;
  const stepId = `${payload.runId}:step:${payload.position}`;
  const rows = await db.select().from(runSchema.runSteps).where(eq(runSchema.runSteps.id, stepId)).limit(1);
  const currentRow = rows[0];
  if (!currentRow) {
    throw new Error(`Run step ${stepId} was not found.`);
  }

  const current = toRunStepState(currentRow);
  assertStepTransition(current.status, payload.status);

  await db
    .update(runSchema.runSteps)
    .set({
      status: payload.status,
      startedAt: payload.startedAt,
      finishedAt: payload.finishedAt,
      exitCode: payload.exitCode,
    })
    .where(eq(runSchema.runSteps.id, stepId));
};
