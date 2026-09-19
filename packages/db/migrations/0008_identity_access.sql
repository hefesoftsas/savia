CREATE TABLE `identity_principal` (
  `id` TEXT PRIMARY KEY NOT NULL,
  `issuer` TEXT NOT NULL,
  `subject` TEXT NOT NULL,
  `email` TEXT NOT NULL,
  `display_name` TEXT NOT NULL,
  `is_active` INTEGER NOT NULL DEFAULT 1,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  CONSTRAINT `identity_principal_issuer_subject_unique` UNIQUE (`issuer`, `subject`)
);
--> statement-breakpoint
CREATE TABLE `identity_global_role` (
  `principal_id` TEXT NOT NULL,
  `role` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  PRIMARY KEY (`principal_id`, `role`),
  FOREIGN KEY (`principal_id`) REFERENCES `identity_principal`(`id`) ON UPDATE no action ON DELETE cascade,
  CHECK (`role` IN ('platform_admin'))
);
--> statement-breakpoint
CREATE TABLE `identity_agency_membership` (
  `id` TEXT PRIMARY KEY NOT NULL,
  `principal_id` TEXT NOT NULL,
  `agency_id` BIGINT NOT NULL,
  `role` TEXT NOT NULL,
  `is_active` INTEGER NOT NULL DEFAULT 1,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  CONSTRAINT `identity_agency_membership_principal_agency_unique` UNIQUE (`principal_id`, `agency_id`),
  FOREIGN KEY (`principal_id`) REFERENCES `identity_principal`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`agency_id`) REFERENCES `agencies`(`id`) ON UPDATE no action ON DELETE cascade,
  CHECK (`role` IN ('agency_admin', 'operator', 'viewer'))
);
--> statement-breakpoint
CREATE INDEX `identity_agency_membership_agency_index` ON `identity_agency_membership` (`agency_id`);
