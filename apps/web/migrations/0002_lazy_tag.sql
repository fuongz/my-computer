CREATE TABLE `user_allowance` (
	`user_id` text PRIMARY KEY NOT NULL,
	`analyses_limit` integer,
	`images_limit` integer,
	`note` text,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
