CREATE TABLE `agency_contacts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`id_slug` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`name` text NOT NULL,
	`surname` text NOT NULL,
	`email` text NOT NULL,
	`phone` text NOT NULL,
	`position` text NOT NULL,
	`agency_id` BIGINT NOT NULL,
	FOREIGN KEY (`agency_id`) REFERENCES `agencies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agency_contacts_id_slug_unique` ON `agency_contacts` (`id_slug`);--> statement-breakpoint
CREATE INDEX `agency_contacts_agency_id_index` ON `agency_contacts` (`agency_id`);