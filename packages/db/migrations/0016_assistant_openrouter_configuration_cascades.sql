CREATE TABLE `assistant_openrouter_settings_rebuilt` (
  `id` TEXT PRIMARY KEY NOT NULL,
  `scope` TEXT NOT NULL,
  `agency_id` BIGINT,
  `api_key_ciphertext` TEXT,
  `api_key_iv` TEXT,
  `model` TEXT,
  `updated_at` TEXT NOT NULL,
  `updated_by` TEXT NOT NULL,
  FOREIGN KEY (`agency_id`) REFERENCES `agencies`(`id`) ON UPDATE no action ON DELETE cascade,
  CHECK (`scope` IN ('global', 'agency')),
  CHECK (
    (`scope` = 'global' AND `id` = 'global' AND `agency_id` IS NULL) OR
    (`scope` = 'agency' AND `id` = 'agency:' || `agency_id` AND `agency_id` IS NOT NULL)
  ),
  CHECK ((`api_key_ciphertext` IS NULL) = (`api_key_iv` IS NULL))
);
--> statement-breakpoint
INSERT INTO `assistant_openrouter_settings_rebuilt` (
  `id`, `scope`, `agency_id`, `api_key_ciphertext`, `api_key_iv`, `model`, `updated_at`, `updated_by`
)
SELECT
  `id`, `scope`, `agency_id`, `api_key_ciphertext`, `api_key_iv`, `model`, `updated_at`, `updated_by`
FROM `assistant_openrouter_settings`;
--> statement-breakpoint
DROP TABLE `assistant_openrouter_settings`;
--> statement-breakpoint
ALTER TABLE `assistant_openrouter_settings_rebuilt` RENAME TO `assistant_openrouter_settings`;
--> statement-breakpoint
CREATE UNIQUE INDEX `assistant_openrouter_settings_agency_unique`
ON `assistant_openrouter_settings` (`agency_id`) WHERE `scope` = 'agency';
--> statement-breakpoint
CREATE TABLE `assistant_active_agencies_rebuilt` (
  `principal_id` TEXT PRIMARY KEY NOT NULL,
  `agency_id` BIGINT NOT NULL,
  `updated_at` TEXT NOT NULL,
  FOREIGN KEY (`principal_id`) REFERENCES `identity_principal`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`agency_id`) REFERENCES `agencies`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `assistant_active_agencies_rebuilt` (`principal_id`, `agency_id`, `updated_at`)
SELECT `principal_id`, `agency_id`, `updated_at`
FROM `assistant_active_agencies`;
--> statement-breakpoint
DROP TABLE `assistant_active_agencies`;
--> statement-breakpoint
ALTER TABLE `assistant_active_agencies_rebuilt` RENAME TO `assistant_active_agencies`;
--> statement-breakpoint
CREATE INDEX `assistant_active_agencies_agency_index`
ON `assistant_active_agencies` (`agency_id`);
