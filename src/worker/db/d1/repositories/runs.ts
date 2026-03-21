import { and, desc, eq, lt, or, sql } from "drizzle-orm";

import { type D1DbExecutor, runIndex } from "@/worker/db/d1";
import type { RunId } from "@/contracts";
import { isTerminalStatus } from "@/worker/contracts";

export type RunIndexRow = typeof runIndex.$inferSelect;
export type NewRunIndexRow = typeof runIndex.$inferInsert;

export interface RunPaginationCursor {
  queuedAt: number;
  runId: string;
}

export interface RunTerminalValues {
  status: string;
  startedAt: number | null;
  finishedAt: number | null;
  exitCode: number | null;
}

export const insertRunIndex = async (db: D1DbExecutor, row: NewRunIndexRow): Promise<void> => {
  await db.insert(runIndex).values(row);
};

export const upsertRunIndex = async (db: D1DbExecutor, row: NewRunIndexRow): Promise<void> => {
  const preserveExistingTerminalFields = !isTerminalStatus(row.status);

  await db
    .insert(runIndex)
    .values(row)
    .onConflictDoUpdate({
      target: runIndex.id,
      set: {
        projectId: row.projectId,
        triggeredByUserId: row.triggeredByUserId,
        triggerType: row.triggerType,
        branch: row.branch,
        commitSha: sql`coalesce(${row.commitSha}, ${runIndex.commitSha})`,
        dispatchMode: row.dispatchMode,
        executionRuntime: row.executionRuntime,
        status: preserveExistingTerminalFields
          ? sql`case when ${runIndex.status} in ('passed', 'failed', 'canceled') then ${runIndex.status} else ${row.status} end`
          : row.status,
        queuedAt: row.queuedAt,
        startedAt: preserveExistingTerminalFields
          ? sql`case when ${runIndex.status} in ('passed', 'failed', 'canceled') then ${runIndex.startedAt} else ${row.startedAt} end`
          : row.startedAt,
        finishedAt: preserveExistingTerminalFields
          ? sql`case when ${runIndex.status} in ('passed', 'failed', 'canceled') then ${runIndex.finishedAt} else ${row.finishedAt} end`
          : row.finishedAt,
        exitCode: preserveExistingTerminalFields
          ? sql`case when ${runIndex.status} in ('passed', 'failed', 'canceled') then ${runIndex.exitCode} else ${row.exitCode} end`
          : row.exitCode,
      },
    });
};

export const findRunIndexById = async (db: D1DbExecutor, runId: RunId): Promise<RunIndexRow | undefined> => {
  const rows = await db.select().from(runIndex).where(eq(runIndex.id, runId)).limit(1);
  return rows[0];
};

export const updateRunIndexTerminal = async (
  db: D1DbExecutor,
  runId: string,
  values: RunTerminalValues,
): Promise<boolean> => {
  const rows = await db.update(runIndex).set(values).where(eq(runIndex.id, runId)).returning({ id: runIndex.id });
  return rows.length === 1;
};

export const listProjectRunsPage = async (
  db: D1DbExecutor,
  projectId: string,
  limit: number,
  cursor?: RunPaginationCursor,
): Promise<RunIndexRow[]> => {
  const where =
    cursor === undefined
      ? eq(runIndex.projectId, projectId)
      : and(
          eq(runIndex.projectId, projectId),
          or(
            lt(runIndex.queuedAt, cursor.queuedAt),
            and(eq(runIndex.queuedAt, cursor.queuedAt), lt(runIndex.id, cursor.runId)),
          ),
        );

  return db.select().from(runIndex).where(where).orderBy(desc(runIndex.queuedAt), desc(runIndex.id)).limit(limit);
};
