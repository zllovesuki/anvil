import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const runMeta = sqliteTable(
  "run_meta",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    status: text("status").notNull(),
    triggerType: text("trigger_type").notNull(),
    branch: text("branch").notNull(),
    commitSha: text("commit_sha"),
    currentStep: integer("current_step"),
    startedAt: integer("started_at"),
    finishedAt: integer("finished_at"),
    exitCode: integer("exit_code"),
    errorMessage: text("error_message"),
  },
  (table) => [index("idx_run_meta_project_started_at").on(table.projectId, table.startedAt)],
);

export const runSteps = sqliteTable(
  "run_steps",
  {
    id: text("id").primaryKey(),
    runId: text("run_id").notNull(),
    position: integer("position").notNull(),
    name: text("name").notNull(),
    command: text("command").notNull(),
    status: text("status").notNull(),
    startedAt: integer("started_at"),
    finishedAt: integer("finished_at"),
    exitCode: integer("exit_code"),
  },
  (table) => [uniqueIndex("idx_run_steps_run_position").on(table.runId, table.position)],
);

export const runLogs = sqliteTable(
  "run_logs",
  {
    id: text("id").primaryKey(),
    runId: text("run_id").notNull(),
    seq: integer("seq").notNull(),
    stream: text("stream").notNull(),
    chunk: text("chunk").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("idx_run_logs_run_seq").on(table.runId, table.seq),
    index("idx_run_logs_run_created_at").on(table.runId, table.createdAt),
  ],
);
