CREATE TABLE `playbooks` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`name` text NOT NULL,
	`side` text NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_playbooks_team_side_archived` ON `playbooks` (`team_id`,`side`,`archived`);
--> statement-breakpoint
ALTER TABLE `plays` ADD `playbook_id` text REFERENCES playbooks(id) ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE `plays` ADD `category` text DEFAULT 'Uncategorized' NOT NULL;
--> statement-breakpoint
CREATE INDEX `idx_plays_playbook_category` ON `plays` (`playbook_id`,`category`);
--> statement-breakpoint
CREATE TABLE `play_assignments` (
	`id` text PRIMARY KEY NOT NULL,
	`play_id` text NOT NULL,
	`position` text NOT NULL,
	`title` text NOT NULL,
	`detail` text DEFAULT '' NOT NULL,
	`sort_order` integer NOT NULL,
	FOREIGN KEY (`play_id`) REFERENCES `plays`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_play_assignment_position` ON `play_assignments` (`play_id`,`position`);
--> statement-breakpoint
CREATE INDEX `idx_play_assignment_order` ON `play_assignments` (`play_id`,`sort_order`);
