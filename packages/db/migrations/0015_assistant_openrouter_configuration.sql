CREATE TABLE `assistant_openrouter_settings` (
  `id` TEXT PRIMARY KEY NOT NULL,
  `scope` TEXT NOT NULL,
  `agency_id` BIGINT,
  `api_key_ciphertext` TEXT,
  `api_key_iv` TEXT,
  `model` TEXT,
  `updated_at` TEXT NOT NULL,
  `updated_by` TEXT NOT NULL,
  FOREIGN KEY (`agency_id`) REFERENCES `agencies`(`id`) ON UPDATE no action ON DELETE restrict,
  CHECK (`scope` IN ('global', 'agency')),
  CHECK (
    (`scope` = 'global' AND `id` = 'global' AND `agency_id` IS NULL) OR
    (`scope` = 'agency' AND `id` = 'agency:' || `agency_id` AND `agency_id` IS NOT NULL)
  ),
  CHECK ((`api_key_ciphertext` IS NULL) = (`api_key_iv` IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `assistant_openrouter_settings_agency_unique`
ON `assistant_openrouter_settings` (`agency_id`) WHERE `scope` = 'agency';
--> statement-breakpoint
CREATE TABLE `assistant_active_agencies` (
  `principal_id` TEXT PRIMARY KEY NOT NULL,
  `agency_id` BIGINT NOT NULL,
  `updated_at` TEXT NOT NULL,
  FOREIGN KEY (`principal_id`) REFERENCES `identity_principal`(`id`) ON UPDATE no action ON DELETE restrict,
  FOREIGN KEY (`agency_id`) REFERENCES `agencies`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `assistant_active_agencies_agency_index`
ON `assistant_active_agencies` (`agency_id`);
