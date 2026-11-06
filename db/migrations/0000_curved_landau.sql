CREATE TABLE `athlete_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`install_item_id` text NOT NULL,
	`athlete_id` text NOT NULL,
	`reviewed_at` text,
	`assignment_acknowledged_at` text,
	`note_acknowledged_at` text,
	FOREIGN KEY (`install_item_id`) REFERENCES `install_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`athlete_id`) REFERENCES `athletes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_athlete_review_item` ON `athlete_reviews` (`install_item_id`,`athlete_id`);--> statement-breakpoint
CREATE TABLE `athletes` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`number` integer NOT NULL,
	`first_name` text NOT NULL,
	`last_name` text NOT NULL,
	`position` text NOT NULL,
	`unit` text NOT NULL,
	`graduation_year` integer NOT NULL,
	`height` text NOT NULL,
	`weight_lb` integer NOT NULL,
	`status` text DEFAULT 'Active' NOT NULL,
	`eligibility` text DEFAULT 'Cleared' NOT NULL,
	`attendance_percent` integer DEFAULT 100 NOT NULL,
	`install_percent` integer DEFAULT 0 NOT NULL,
	`email` text,
	`phone` text,
	`staff_note` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_athletes_team_number` ON `athletes` (`team_id`,`number`);--> statement-breakpoint
CREATE INDEX `idx_athletes_team_unit` ON `athletes` (`team_id`,`unit`);--> statement-breakpoint
CREATE INDEX `idx_athletes_team_status` ON `athletes` (`team_id`,`status`);--> statement-breakpoint
CREATE TABLE `calendar_events` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`game_id` text,
	`title` text NOT NULL,
	`event_type` text NOT NULL,
	`starts_at` text NOT NULL,
	`ends_at` text NOT NULL,
	`location` text NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_calendar_events_team_start` ON `calendar_events` (`team_id`,`starts_at`);--> statement-breakpoint
CREATE TABLE `conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`name` text NOT NULL,
	`visibility` text DEFAULT 'team' NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `depth_assignments` (
	`id` text PRIMARY KEY NOT NULL,
	`depth_chart_id` text NOT NULL,
	`athlete_id` text NOT NULL,
	`position` text NOT NULL,
	`rank` integer NOT NULL,
	`x` real NOT NULL,
	`y` real NOT NULL,
	FOREIGN KEY (`depth_chart_id`) REFERENCES `depth_charts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`athlete_id`) REFERENCES `athletes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_depth_assignment_slot` ON `depth_assignments` (`depth_chart_id`,`position`,`rank`);--> statement-breakpoint
CREATE INDEX `idx_depth_assignment_athlete` ON `depth_assignments` (`athlete_id`);--> statement-breakpoint
CREATE TABLE `depth_charts` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`game_id` text,
	`formation_id` text,
	`name` text NOT NULL,
	`unit` text NOT NULL,
	`published_at` text,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`formation_id`) REFERENCES `formations`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `film_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`game_id` text,
	`title` text NOT NULL,
	`storage_key` text,
	`duration_seconds` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'local-placeholder' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `film_clips` (
	`id` text PRIMARY KEY NOT NULL,
	`film_asset_id` text NOT NULL,
	`play_id` text,
	`clip_number` integer NOT NULL,
	`start_seconds` real NOT NULL,
	`end_seconds` real NOT NULL,
	`odk` text,
	`down` integer,
	`distance` integer,
	`yard_line` text,
	`result` text,
	`tags_json` text DEFAULT '[]' NOT NULL,
	FOREIGN KEY (`film_asset_id`) REFERENCES `film_assets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`play_id`) REFERENCES `plays`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_film_clips_asset_number` ON `film_clips` (`film_asset_id`,`clip_number`);--> statement-breakpoint
CREATE TABLE `formations` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`name` text NOT NULL,
	`unit` text NOT NULL,
	`personnel` text NOT NULL,
	`layout_json` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_formations_team_name_unit` ON `formations` (`team_id`,`name`,`unit`);--> statement-breakpoint
CREATE TABLE `games` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`opponent` text NOT NULL,
	`kickoff_at` text NOT NULL,
	`venue` text NOT NULL,
	`status` text DEFAULT 'scheduled' NOT NULL,
	`home_away` text DEFAULT 'home' NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_games_team_kickoff` ON `games` (`team_id`,`kickoff_at`);--> statement-breakpoint
CREATE TABLE `install_items` (
	`id` text PRIMARY KEY NOT NULL,
	`package_id` text NOT NULL,
	`play_id` text,
	`title` text NOT NULL,
	`item_type` text NOT NULL,
	`position_group` text,
	`sort_order` integer NOT NULL,
	FOREIGN KEY (`package_id`) REFERENCES `install_packages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`play_id`) REFERENCES `plays`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `install_packages` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`game_id` text,
	`name` text NOT NULL,
	`unit` text NOT NULL,
	`due_at` text NOT NULL,
	`published_at` text,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`author_name` text NOT NULL,
	`body` text NOT NULL,
	`attachment_type` text,
	`attachment_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_messages_conversation_created` ON `messages` (`conversation_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `plays` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`formation_id` text,
	`name` text NOT NULL,
	`unit` text NOT NULL,
	`family` text NOT NULL,
	`concept` text NOT NULL,
	`diagram_json` text NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`formation_id`) REFERENCES `formations`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_plays_team_unit_formation` ON `plays` (`team_id`,`unit`,`formation_id`);--> statement-breakpoint
CREATE TABLE `practice_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`game_id` text,
	`title` text NOT NULL,
	`practice_date` text NOT NULL,
	`duration_minutes` integer NOT NULL,
	`plan_json` text NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `teams` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`short_name` text NOT NULL,
	`season` text NOT NULL,
	`created_at` text NOT NULL
);
