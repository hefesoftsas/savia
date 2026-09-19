CREATE TABLE `countries` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`code` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `countries_name_unique` ON `countries` (`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `countries_code_unique` ON `countries` (`code`);--> statement-breakpoint
CREATE TABLE `departments` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`country_id` integer NOT NULL,
	`external_id` integer NOT NULL,
	FOREIGN KEY (`country_id`) REFERENCES `countries`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `departments_country_id_index` ON `departments` (`country_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `departments_external_id_unique` ON `departments` (`external_id`);--> statement-breakpoint
CREATE TABLE `cities` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`department_id` integer NOT NULL,
	`external_id` integer NOT NULL,
	FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `cities_department_id_index` ON `cities` (`department_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `cities_external_id_unique` ON `cities` (`external_id`);
