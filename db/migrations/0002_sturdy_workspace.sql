CREATE TABLE `workspace_state` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`state_key` text NOT NULL,
	`value_json` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_workspace_state_team_key` ON `workspace_state` (`team_id`,`state_key`);
