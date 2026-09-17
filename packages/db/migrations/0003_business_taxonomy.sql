CREATE TABLE `categories` (
	`id` BIGINT PRIMARY KEY NOT NULL,
	`id_slug` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`name` text NOT NULL,
	`external_id` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `categories_id_slug_unique` ON `categories` (`id_slug`);--> statement-breakpoint
CREATE TABLE `sub_ramos` (
	`id` BIGINT PRIMARY KEY NOT NULL,
	`id_slug` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`name` text NOT NULL,
	`category_id` BIGINT NOT NULL,
	`external_ids` text,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sub_ramos_id_slug_unique` ON `sub_ramos` (`id_slug`);--> statement-breakpoint
CREATE INDEX `sub_ramos_category_id_index` ON `sub_ramos` (`category_id`);--> statement-breakpoint
CREATE TABLE `ramos` (
	`id` BIGINT PRIMARY KEY NOT NULL,
	`id_slug` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`name` text NOT NULL,
	`sub_ramo_id` BIGINT NOT NULL,
	`tax_iva` text NOT NULL,
	`external_id` integer,
	`manage_reinvestment` integer NOT NULL,
	`has_monthly_payment` integer NOT NULL,
	`allow_custom_renewal_days` integer NOT NULL,
	`is_non_renewable` integer NOT NULL,
	`insurance_subject_validation` text NOT NULL,
	`insurance_subject_validation_message` text NOT NULL,
	`monthly_payment_form_label` text NOT NULL,
	`compliance_policy_type` text NOT NULL,
	FOREIGN KEY (`sub_ramo_id`) REFERENCES `sub_ramos`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ramos_id_slug_unique` ON `ramos` (`id_slug`);--> statement-breakpoint
CREATE INDEX `ramos_sub_ramo_id_index` ON `ramos` (`sub_ramo_id`);
