CREATE TABLE `insurer_companies` (
	`id` BIGINT PRIMARY KEY NOT NULL,
	`id_slug` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`name` text NOT NULL,
	`id_number` text NOT NULL,
	`name_long` text NOT NULL,
	`id_check_digit` text NOT NULL,
	`external_id` integer,
	`reconciliation_type` text NOT NULL,
	`payment_url` text NOT NULL,
	`vendu_code` text NOT NULL,
	`collection_reconciliation_type` text NOT NULL,
	`payment_information` text NOT NULL,
	`assistance_line` text NOT NULL,
	`is_active` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `insurer_companies_id_slug_unique` ON `insurer_companies` (`id_slug`);--> statement-breakpoint
CREATE INDEX `insurer_companies_reconciliation_type_index` ON `insurer_companies` (`reconciliation_type`);--> statement-breakpoint
CREATE INDEX `insurer_companies_collection_reconciliation_type_index` ON `insurer_companies` (`collection_reconciliation_type`);