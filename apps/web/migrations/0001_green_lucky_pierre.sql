CREATE TABLE `daily_allowance` (
	`user_id` text NOT NULL,
	`day` text NOT NULL,
	`analyses_used` integer DEFAULT 0 NOT NULL,
	`images_used` integer DEFAULT 0 NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`user_id`, `day`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `generation` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`api_key_id` text,
	`kind` text NOT NULL,
	`mode` text NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`status` text NOT NULL,
	`retained` integer DEFAULT false NOT NULL,
	`prompt` text,
	`source_image_url` text,
	`provider_request_id` text,
	`output_key` text,
	`output_content_type` text,
	`input_tokens` integer,
	`output_tokens` integer,
	`cost_micro_usd` integer,
	`cost_source` text,
	`latency_ms` integer,
	`error_code` text,
	`error_message` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `generation_user_created_idx` ON `generation` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `generation_status_idx` ON `generation` (`status`);--> statement-breakpoint
CREATE TABLE `provider_credential` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`ciphertext` text NOT NULL,
	`iv` text NOT NULL,
	`last4` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `provider_credential_user_provider_idx` ON `provider_credential` (`user_id`,`provider`);--> statement-breakpoint
CREATE TABLE `system_allowance` (
	`day` text PRIMARY KEY NOT NULL,
	`analyses_used` integer DEFAULT 0 NOT NULL,
	`images_used` integer DEFAULT 0 NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
-- Hand-added, not generated. The API-key plugin stamps its rate limit onto each key
-- ROW at creation time, so raising the config in @fuongz/auth only affects keys
-- minted afterwards. Without this, any key issued before this migration keeps the
-- plugin's 10-requests-per-day default and dies on its first real session.
UPDATE `apikey` SET `rate_limit_time_window` = 60000, `rate_limit_max` = 60
WHERE `rate_limit_time_window` = 86400000 AND `rate_limit_max` = 10;
