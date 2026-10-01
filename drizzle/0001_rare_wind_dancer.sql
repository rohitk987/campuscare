CREATE TABLE `cohorts` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`name` text NOT NULL,
	`admission_year` integer NOT NULL,
	`starts_at` integer NOT NULL,
	`ends_at` integer NOT NULL,
	`active` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `otp_challenges` (
	`user_id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`challenge_id` text NOT NULL,
	`code_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`consumed_at` integer,
	`attempt_marker` text,
	`last_sent_at` integer NOT NULL,
	`window_started_at` integer NOT NULL,
	`send_count` integer NOT NULL,
	`delivery` text DEFAULT 'pending' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `otp_challenges_challenge_id_unique` ON `otp_challenges` (`challenge_id`);--> statement-breakpoint
CREATE TABLE `otp_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`email` text NOT NULL,
	`challenge_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `otp_sessions_challenge_id_unique` ON `otp_sessions` (`challenge_id`);--> statement-breakpoint
CREATE INDEX `otp_sessions_user` ON `otp_sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `student_records` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`usn` text NOT NULL,
	`cohort_id` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`cohort_id`) REFERENCES `cohorts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `students_org_email` ON `student_records` (`org_id`,`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `students_org_usn` ON `student_records` (`org_id`,`usn`);