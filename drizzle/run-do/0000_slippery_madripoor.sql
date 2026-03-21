CREATE TABLE `run_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`seq` integer NOT NULL,
	`stream` text NOT NULL,
	`chunk` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_run_logs_run_seq` ON `run_logs` (`run_id`,`seq`);--> statement-breakpoint
CREATE INDEX `idx_run_logs_run_created_at` ON `run_logs` (`run_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `run_meta` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`status` text NOT NULL,
	`trigger_type` text NOT NULL,
	`branch` text NOT NULL,
	`commit_sha` text,
	`current_step` integer,
	`started_at` integer,
	`finished_at` integer,
	`exit_code` integer,
	`error_message` text
);
--> statement-breakpoint
CREATE INDEX `idx_run_meta_project_started_at` ON `run_meta` (`project_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `run_steps` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`position` integer NOT NULL,
	`name` text NOT NULL,
	`command` text NOT NULL,
	`status` text NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	`exit_code` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_run_steps_run_position` ON `run_steps` (`run_id`,`position`);