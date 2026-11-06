CREATE TABLE IF NOT EXISTS `games` (
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
CREATE INDEX IF NOT EXISTS `idx_games_team_kickoff` ON `games` (`team_id`,`kickoff_at`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `practice_plans` (
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
CREATE INDEX IF NOT EXISTS `idx_practice_plans_team_date` ON `practice_plans` (`team_id`,`practice_date`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `film_assets` (
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
CREATE INDEX IF NOT EXISTS `idx_film_assets_team_created` ON `film_assets` (`team_id`,`created_at`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `film_clips` (
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
CREATE INDEX IF NOT EXISTS `idx_film_clips_asset_number` ON `film_clips` (`film_asset_id`,`clip_number`);
