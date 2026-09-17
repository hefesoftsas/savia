CREATE TABLE `agency_branches` (
	`id` BIGINT PRIMARY KEY NOT NULL,
	`id_slug` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`name` text NOT NULL,
	`is_active` integer NOT NULL,
	`agency_id` BIGINT NOT NULL,
	`city_id` integer NOT NULL,
	FOREIGN KEY (`agency_id`) REFERENCES `agencies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`city_id`) REFERENCES `cities`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agency_branches_id_slug_unique` ON `agency_branches` (`id_slug`);--> statement-breakpoint
CREATE INDEX `agency_branches_agency_id_index` ON `agency_branches` (`agency_id`);--> statement-breakpoint
CREATE INDEX `agency_branches_city_id_index` ON `agency_branches` (`city_id`);