PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_athletes` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`number` integer,
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
	`email` text NOT NULL,
	`phone` text,
	`staff_note` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_athletes`("id", "team_id", "number", "first_name", "last_name", "position", "unit", "graduation_year", "height", "weight_lb", "status", "eligibility", "attendance_percent", "install_percent", "email", "phone", "staff_note", "created_at", "updated_at") SELECT "id", "team_id", "number", "first_name", "last_name", "position", "unit", "graduation_year", "height", "weight_lb", "status", "eligibility", "attendance_percent", "install_percent", "email", "phone", "staff_note", "created_at", "updated_at" FROM `athletes`;--> statement-breakpoint
DROP TABLE `athletes`;--> statement-breakpoint
ALTER TABLE `__new_athletes` RENAME TO `athletes`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_athletes_team_number` ON `athletes` (`team_id`,`number`) WHERE "athletes"."number" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_athletes_team_email` ON `athletes` (`team_id`,`email`);--> statement-breakpoint
CREATE INDEX `idx_athletes_team_unit` ON `athletes` (`team_id`,`unit`);--> statement-breakpoint
CREATE INDEX `idx_athletes_team_status` ON `athletes` (`team_id`,`status`);