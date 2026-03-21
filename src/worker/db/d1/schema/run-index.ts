import { desc } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const runIndex = sqliteTable(
  "run_index",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    triggeredByUserId: text("triggered_by_user_id"),
    triggerType: text("trigger_type").notNull(),
    branch: text("branch").notNull(),
    commitSha: text("commit_sha"),
    status: text("status").notNull(),
    dispatchMode: text("dispatch_mode").notNull(),
    executionRuntime: text("execution_runtime").notNull(),
    queuedAt: integer("queued_at").notNull(),
    startedAt: integer("started_at"),
    finishedAt: integer("finished_at"),
    exitCode: integer("exit_code"),
  },
  (table) => [
    index("idx_run_index_project_queued_at").on(table.projectId, desc(table.queuedAt)),
    index("idx_run_index_project_started_at").on(table.projectId, desc(table.startedAt)),
    index("idx_run_index_user_queued_at").on(table.triggeredByUserId, desc(table.queuedAt)),
    index("idx_run_index_status_queued_at").on(table.status, desc(table.queuedAt)),
  ],
);
