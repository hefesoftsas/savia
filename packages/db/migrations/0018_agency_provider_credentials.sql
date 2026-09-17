CREATE TABLE `agency_provider_credentials` (
  `id` TEXT PRIMARY KEY NOT NULL,
  `agency_id` BIGINT NOT NULL,
  `provider` TEXT NOT NULL,
  `schema_version` INTEGER NOT NULL,
  `credential_ciphertext` TEXT NOT NULL,
  `credential_iv` TEXT NOT NULL,
  `last_validation_status` TEXT,
  `last_validation_error_code` TEXT,
  `last_validated_at` TEXT,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `created_by_principal_id` TEXT NOT NULL,
  `updated_by_principal_id` TEXT NOT NULL,
  FOREIGN KEY (`agency_id`) REFERENCES `agencies`(`id`) ON UPDATE no action ON DELETE restrict,
  FOREIGN KEY (`created_by_principal_id`) REFERENCES `identity_principal`(`id`) ON UPDATE no action ON DELETE restrict,
  FOREIGN KEY (`updated_by_principal_id`) REFERENCES `identity_principal`(`id`) ON UPDATE no action ON DELETE restrict,
  CHECK (`schema_version` > 0),
  CHECK (`last_validation_status` IN ('valid', 'invalid') OR `last_validation_status` IS NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agency_provider_credentials_agency_provider_unique`
  ON `agency_provider_credentials` (`agency_id`, `provider`);
--> statement-breakpoint
CREATE INDEX `agency_provider_credentials_agency_index`
  ON `agency_provider_credentials` (`agency_id`);
--> statement-breakpoint
CREATE TABLE `agency_provider_credential_audit_events` (
  `id` TEXT PRIMARY KEY NOT NULL,
  `agency_id` BIGINT NOT NULL,
  `provider` TEXT NOT NULL,
  `actor_principal_id` TEXT NOT NULL,
  `event_type` TEXT NOT NULL,
  `outcome` TEXT NOT NULL,
  `error_code` TEXT,
  `created_at` TEXT NOT NULL,
  FOREIGN KEY (`agency_id`) REFERENCES `agencies`(`id`) ON UPDATE no action ON DELETE restrict,
  FOREIGN KEY (`actor_principal_id`) REFERENCES `identity_principal`(`id`) ON UPDATE no action ON DELETE restrict,
  CHECK (`event_type` IN ('created', 'replaced', 'tested', 'deleted'))
);
--> statement-breakpoint
CREATE INDEX `agency_provider_credential_audit_events_agency_created_at_index`
  ON `agency_provider_credential_audit_events` (`agency_id`, `created_at`);
