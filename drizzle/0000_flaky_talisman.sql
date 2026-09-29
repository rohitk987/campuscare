CREATE TABLE `buildings` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`site_id` text NOT NULL,
	`name` text NOT NULL,
	`latitude` real,
	`longitude` real,
	`radius` real DEFAULT 35 NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organisations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `complaints` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`site_id` text NOT NULL,
	`location_id` text NOT NULL,
	`reporter_id` text NOT NULL,
	`reporter_name` text NOT NULL,
	`ticket_no` text NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`item` text NOT NULL,
	`category` text NOT NULL,
	`priority` text DEFAULT 'Medium' NOT NULL,
	`verification` text DEFAULT 'pending' NOT NULL,
	`status` text DEFAULT 'not_started' NOT NULL,
	`assignee_id` text,
	`duplicate_id` text,
	`reopen` text DEFAULT 'none' NOT NULL,
	`visibility` text DEFAULT 'shared' NOT NULL,
	`session_id` text,
	`demo` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`resolved_at` integer,
	`version` integer DEFAULT 1 NOT NULL,
	`last_event_id` text,
	FOREIGN KEY (`org_id`) REFERENCES `organisations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `complaints_session_id_unique` ON `complaints` (`session_id`);--> statement-breakpoint
CREATE INDEX `complaints_org_date` ON `complaints` (`org_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `complaints_assignee` ON `complaints` (`org_id`,`assignee_id`);--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`complaint_id` text NOT NULL,
	`actor` text NOT NULL,
	`action` text NOT NULL,
	`note` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`complaint_id`) REFERENCES `complaints`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `events_ticket` ON `events` (`org_id`,`complaint_id`);--> statement-breakpoint
CREATE TABLE `followers` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`complaint_id` text NOT NULL,
	`user_id` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `followers_ticket_user` ON `followers` (`complaint_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `locations` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`building_id` text NOT NULL,
	`floor` text NOT NULL,
	`name` text NOT NULL,
	`private` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organisations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`building_id`) REFERENCES `buildings`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `members` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`user_id` text,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`role` text NOT NULL,
	`site_scope` text DEFAULT '*' NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organisations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `members_org_email` ON `members` (`org_id`,`email`);--> statement-breakpoint
CREATE INDEX `members_user` ON `members` (`user_id`);--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`user_id` text NOT NULL,
	`complaint_id` text NOT NULL,
	`message` text NOT NULL,
	`created_at` integer NOT NULL,
	`read_at` integer
);
--> statement-breakpoint
CREATE INDEX `notifications_user_org` ON `notifications` (`user_id`,`org_id`);--> statement-breakpoint
CREATE TABLE `organisations` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`color` text DEFAULT '#305bea' NOT NULL,
	`demo` integer DEFAULT 0 NOT NULL,
	`creator` text NOT NULL,
	`created_at` integer NOT NULL,
	`max_accuracy` integer DEFAULT 50 NOT NULL,
	`response_hours` integer DEFAULT 24 NOT NULL,
	`emergency_contact` text DEFAULT 'Contact your site security or reception.' NOT NULL,
	`identifier_label` text DEFAULT 'Member ID' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `report_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`user_id` text NOT NULL,
	`site_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`location_id` text,
	`image_key` text,
	`latitude` real,
	`longitude` real,
	`accuracy` real,
	`captured_at` integer,
	`received_at` integer,
	`consumed` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sessions_actor` ON `report_sessions` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `sites` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`name` text NOT NULL,
	`latitude` real,
	`longitude` real,
	`radius` real DEFAULT 150 NOT NULL,
	`enabled` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organisations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `sites_org` ON `sites` (`org_id`);