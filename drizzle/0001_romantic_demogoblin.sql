DROP INDEX `idx_film_clips_asset_number`;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_film_clip_number_unique` ON `film_clips` (`film_asset_id`,`clip_number`);