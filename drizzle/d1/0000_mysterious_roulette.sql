CREATE TABLE `invites` (
	`id` text PRIMARY KEY NOT NULL,
	`created_by_user_id` text NOT NULL,
	`token_hash` blob NOT NULL,
	`expires_at` integer NOT NULL,
	`accepted_by_user_id` text,
	`accepted_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_invites_token_hash` ON `invites` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_invites_created_by_created_at` ON `invites` (`created_by_user_id`,"created_at" desc);--> statement-breakpoint
CREATE INDEX `idx_invites_expires_at` ON `invites` (`expires_at`);--> statement-breakpoint
CREATE TABLE `password_credentials` (
	`user_id` text PRIMARY KEY NOT NULL,
	`algorithm` text NOT NULL,
	`digest` text NOT NULL,
	`iterations` integer NOT NULL,
	`salt` blob NOT NULL,
	`password_hash` blob NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `project_index` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`owner_slug` text NOT NULL,
	`project_slug` text NOT NULL,
	`name` text NOT NULL,
	`repo_url` text NOT NULL,
	`default_branch` text NOT NULL,
	`config_path` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_project_index_owner_project_slug` ON `project_index` (`owner_slug`,`project_slug`);--> statement-breakpoint
CREATE INDEX `idx_project_index_owner_user_updated_at` ON `project_index` (`owner_user_id`,"updated_at" desc);--> statement-breakpoint
CREATE INDEX `idx_project_index_updated_at` ON `project_index` ("updated_at" desc);--> statement-breakpoint
CREATE TABLE `run_index` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`triggered_by_user_id` text,
	`trigger_type` text NOT NULL,
	`branch` text NOT NULL,
	`commit_sha` text,
	`status` text NOT NULL,
	`dispatch_mode` text NOT NULL,
	`execution_runtime` text NOT NULL,
	`queued_at` integer NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	`exit_code` integer
);
--> statement-breakpoint
CREATE INDEX `idx_run_index_project_queued_at` ON `run_index` (`project_id`,"queued_at" desc);--> statement-breakpoint
CREATE INDEX `idx_run_index_project_started_at` ON `run_index` (`project_id`,"started_at" desc);--> statement-breakpoint
CREATE INDEX `idx_run_index_user_queued_at` ON `run_index` (`triggered_by_user_id`,"queued_at" desc);--> statement-breakpoint
CREATE INDEX `idx_run_index_status_queued_at` ON `run_index` (`status`,"queued_at" desc);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`email` text NOT NULL,
	`display_name` text NOT NULL,
	`created_at` integer NOT NULL,
	`disabled_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_users_slug` ON `users` (`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_users_email` ON `users` (`email`);