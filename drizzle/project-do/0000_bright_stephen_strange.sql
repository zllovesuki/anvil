CREATE TABLE `project_config` (
	`project_id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`repo_url` text NOT NULL,
	`default_branch` text NOT NULL,
	`config_path` text NOT NULL,
	`repo_token_ciphertext` blob,
	`repo_token_key_version` integer,
	`repo_token_nonce` blob,
	`dispatch_mode` text NOT NULL,
	`execution_runtime` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `project_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`run_id` text NOT NULL,
	`trigger_type` text NOT NULL,
	`triggered_by_user_id` text,
	`branch` text NOT NULL,
	`commit_sha` text,
	`provider` text,
	`delivery_id` text,
	`repo_url` text NOT NULL,
	`config_path` text NOT NULL,
	`position` integer,
	`status` text NOT NULL,
	`d1_sync_status` text NOT NULL,
	`dispatch_mode` text NOT NULL,
	`execution_runtime` text NOT NULL,
	`dispatch_status` text NOT NULL,
	`dispatch_attempts` integer NOT NULL,
	`last_error` text,
	`created_at` integer NOT NULL,
	`cancel_requested_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_project_runs_project_position` ON `project_runs` (`project_id`,`position`);--> statement-breakpoint
CREATE INDEX `idx_project_runs_project_status_position` ON `project_runs` (`project_id`,`status`,`position`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_project_runs_run_id` ON `project_runs` (`run_id`);--> statement-breakpoint
CREATE TABLE `project_state` (
	`project_id` text PRIMARY KEY NOT NULL,
	`active_run_id` text,
	`project_index_sync_status` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `project_webhook_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`provider` text NOT NULL,
	`delivery_id` text NOT NULL,
	`event_kind` text NOT NULL,
	`event_name` text NOT NULL,
	`outcome` text NOT NULL,
	`repo_url` text NOT NULL,
	`ref` text,
	`branch` text,
	`commit_sha` text,
	`before_sha` text,
	`run_id` text,
	`received_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_project_webhook_deliveries_project_provider_delivery` ON `project_webhook_deliveries` (`project_id`,`provider`,`delivery_id`);--> statement-breakpoint
CREATE INDEX `idx_project_webhook_deliveries_project_received_at` ON `project_webhook_deliveries` (`project_id`,`received_at`);--> statement-breakpoint
CREATE TABLE `project_webhooks` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`provider` text NOT NULL,
	`config_json` text,
	`secret_ciphertext` blob NOT NULL,
	`secret_key_version` integer NOT NULL,
	`secret_nonce` blob NOT NULL,
	`enabled` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_project_webhooks_project_provider` ON `project_webhooks` (`project_id`,`provider`);--> statement-breakpoint
CREATE INDEX `idx_project_webhooks_provider_enabled` ON `project_webhooks` (`provider`,`enabled`);--> statement-breakpoint
CREATE INDEX `idx_project_webhooks_project_enabled` ON `project_webhooks` (`project_id`,`enabled`);