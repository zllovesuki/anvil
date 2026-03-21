import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { bytes } from "@/worker/db";

export const projectState = sqliteTable("project_state", {
  projectId: text("project_id").primaryKey(),
  activeRunId: text("active_run_id"),
  projectIndexSyncStatus: text("project_index_sync_status").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const projectConfig = sqliteTable("project_config", {
  projectId: text("project_id").primaryKey(),
  name: text("name").notNull(),
  repoUrl: text("repo_url").notNull(),
  defaultBranch: text("default_branch").notNull(),
  configPath: text("config_path").notNull(),
  repoTokenCiphertext: bytes("repo_token_ciphertext"),
  repoTokenKeyVersion: integer("repo_token_key_version"),
  repoTokenNonce: bytes("repo_token_nonce"),
  dispatchMode: text("dispatch_mode").notNull(),
  executionRuntime: text("execution_runtime").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const projectRuns = sqliteTable(
  "project_runs",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    runId: text("run_id").notNull(),
    triggerType: text("trigger_type").notNull(),
    triggeredByUserId: text("triggered_by_user_id"),
    branch: text("branch").notNull(),
    commitSha: text("commit_sha"),
    provider: text("provider"),
    deliveryId: text("delivery_id"),
    repoUrl: text("repo_url").notNull(),
    configPath: text("config_path").notNull(),
    position: integer("position"),
    status: text("status").notNull(),
    d1SyncStatus: text("d1_sync_status").notNull(),
    dispatchMode: text("dispatch_mode").notNull(),
    executionRuntime: text("execution_runtime").notNull(),
    dispatchStatus: text("dispatch_status").notNull(),
    dispatchAttempts: integer("dispatch_attempts").notNull(),
    lastError: text("last_error"),
    createdAt: integer("created_at").notNull(),
    cancelRequestedAt: integer("cancel_requested_at"),
  },
  (table) => [
    uniqueIndex("idx_project_runs_project_position").on(table.projectId, table.position),
    index("idx_project_runs_project_status_position").on(table.projectId, table.status, table.position),
    uniqueIndex("idx_project_runs_run_id").on(table.runId),
  ],
);

export const projectWebhooks = sqliteTable(
  "project_webhooks",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    provider: text("provider").notNull(),
    configJson: text("config_json"),
    secretCiphertext: bytes("secret_ciphertext").notNull(),
    secretKeyVersion: integer("secret_key_version").notNull(),
    secretNonce: bytes("secret_nonce").notNull(),
    enabled: integer("enabled").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("idx_project_webhooks_project_provider").on(table.projectId, table.provider),
    index("idx_project_webhooks_provider_enabled").on(table.provider, table.enabled),
    index("idx_project_webhooks_project_enabled").on(table.projectId, table.enabled),
  ],
);

export const projectWebhookDeliveries = sqliteTable(
  "project_webhook_deliveries",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    provider: text("provider").notNull(),
    deliveryId: text("delivery_id").notNull(),
    eventKind: text("event_kind").notNull(),
    eventName: text("event_name").notNull(),
    outcome: text("outcome").notNull(),
    repoUrl: text("repo_url").notNull(),
    ref: text("ref"),
    branch: text("branch"),
    commitSha: text("commit_sha"),
    beforeSha: text("before_sha"),
    runId: text("run_id"),
    receivedAt: integer("received_at").notNull(),
  },
  (table) => [
    uniqueIndex("idx_project_webhook_deliveries_project_provider_delivery").on(
      table.projectId,
      table.provider,
      table.deliveryId,
    ),
    index("idx_project_webhook_deliveries_project_received_at").on(table.projectId, table.receivedAt),
  ],
);
