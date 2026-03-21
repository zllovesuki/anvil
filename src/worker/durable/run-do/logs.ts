import { asc, desc, eq } from "drizzle-orm";

import { LogStream, OpaqueId, RunId, UnixTimestampMs } from "@/contracts";
import { type AppendRunLogsInput, expectTrusted, PositiveInteger, type RunLogRecord } from "@/worker/contracts";
import * as runSchema from "@/worker/db/durable/schema/run-do";

import { chunkRows, toRunLogRecord, type RunDb, type RunTx } from "./repo";

const MAX_HOT_LOG_BYTES = 2 * 1024 * 1024;
const MAX_SQL_BOUND_PARAMETERS = 100;
const RUN_LOG_INSERT_COLUMN_COUNT = 6;
const MAX_RUN_LOG_ROWS_PER_INSERT = Math.floor(MAX_SQL_BOUND_PARAMETERS / RUN_LOG_INSERT_COLUMN_COUNT);
const textEncoder = new TextEncoder();

const toAppendedRunLogRecord = (
  row: Pick<typeof runSchema.runLogs.$inferInsert, "id" | "runId" | "seq" | "stream" | "chunk" | "createdAt">,
): RunLogRecord => ({
  id: expectTrusted(OpaqueId, row.id, "OpaqueId"),
  runId: expectTrusted(RunId, row.runId, "RunId"),
  seq: expectTrusted(PositiveInteger, row.seq, "PositiveInteger"),
  stream: expectTrusted(LogStream, row.stream, "LogStream"),
  chunk: row.chunk,
  createdAt: expectTrusted(UnixTimestampMs, row.createdAt, "UnixTimestampMs"),
});

export const listRunLogs = async (db: RunDb, runId: RunId): Promise<RunLogRecord[]> => {
  const rows = await db
    .select()
    .from(runSchema.runLogs)
    .where(eq(runSchema.runLogs.runId, runId))
    .orderBy(asc(runSchema.runLogs.seq));

  return rows.map(toRunLogRecord);
};

export const pruneLogs = async (db: RunDb, runId: RunId): Promise<void> => {
  const rows = await db
    .select({
      id: runSchema.runLogs.id,
      chunk: runSchema.runLogs.chunk,
    })
    .from(runSchema.runLogs)
    .where(eq(runSchema.runLogs.runId, runId))
    .orderBy(desc(runSchema.runLogs.seq));

  let retainedBytes = 0;
  const deleteIds: string[] = [];

  for (const row of rows) {
    retainedBytes += textEncoder.encode(row.chunk).length;
    if (retainedBytes > MAX_HOT_LOG_BYTES) {
      deleteIds.push(row.id);
    }
  }

  for (const id of deleteIds) {
    await db.delete(runSchema.runLogs).where(eq(runSchema.runLogs.id, id));
  }
};

export const appendLogs = async (db: RunDb, input: AppendRunLogsInput): Promise<RunLogRecord[]> => {
  const payload = input;
  if (payload.events.length === 0) {
    return [];
  }

  let appendedLogs: RunLogRecord[] = [];

  db.transaction((tx: RunTx) => {
    const latestRow = tx
      .select({ seq: runSchema.runLogs.seq })
      .from(runSchema.runLogs)
      .where(eq(runSchema.runLogs.runId, payload.runId))
      .orderBy(desc(runSchema.runLogs.seq))
      .limit(1)
      .get();

    let nextSeq = (latestRow?.seq ?? 0) + 1;
    const logRows = payload.events.map((event) => {
      const currentSeq = nextSeq;
      nextSeq += 1;

      return {
        id: `${payload.runId}:log:${currentSeq}`,
        runId: payload.runId,
        seq: currentSeq,
        stream: event.stream,
        chunk: event.chunk,
        createdAt: event.createdAt,
      };
    });

    appendedLogs = logRows.map(toAppendedRunLogRecord);

    for (const batch of chunkRows(logRows, MAX_RUN_LOG_ROWS_PER_INSERT)) {
      tx.insert(runSchema.runLogs).values(batch).run();
    }
  });

  await pruneLogs(db, payload.runId);
  return appendedLogs;
};
