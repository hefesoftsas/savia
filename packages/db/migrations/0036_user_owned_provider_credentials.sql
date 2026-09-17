-- Shared test credentials are deliberately discarded; ciphertext was bound to the agency.
DROP TABLE agency_provider_credential_audit_events;
--> statement-breakpoint
DROP TABLE agency_provider_credentials;
--> statement-breakpoint
CREATE TABLE `user_provider_credentials` (
  `id` TEXT PRIMARY KEY NOT NULL,
  `owner_principal_id` TEXT NOT NULL,
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
  FOREIGN KEY (`owner_principal_id`) REFERENCES `identity_principal`(`id`) ON UPDATE no action ON DELETE restrict,
  FOREIGN KEY (`created_by_principal_id`) REFERENCES `identity_principal`(`id`) ON UPDATE no action ON DELETE restrict,
  FOREIGN KEY (`updated_by_principal_id`) REFERENCES `identity_principal`(`id`) ON UPDATE no action ON DELETE restrict,
  CHECK (`schema_version` > 0),
  CHECK (`last_validation_status` IN ('valid', 'invalid') OR `last_validation_status` IS NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_provider_credentials_owner_provider_unique`
  ON `user_provider_credentials` (`owner_principal_id`, `provider`);
--> statement-breakpoint
CREATE INDEX `user_provider_credentials_owner_index`
  ON `user_provider_credentials` (`owner_principal_id`);
--> statement-breakpoint
CREATE TABLE `user_provider_credential_audit_events` (
  `id` TEXT PRIMARY KEY NOT NULL,
  `owner_principal_id` TEXT NOT NULL,
  `provider` TEXT NOT NULL,
  `actor_principal_id` TEXT NOT NULL,
  `event_type` TEXT NOT NULL,
  `outcome` TEXT NOT NULL,
  `error_code` TEXT,
  `created_at` TEXT NOT NULL,
  FOREIGN KEY (`owner_principal_id`) REFERENCES `identity_principal`(`id`) ON UPDATE no action ON DELETE restrict,
  FOREIGN KEY (`actor_principal_id`) REFERENCES `identity_principal`(`id`) ON UPDATE no action ON DELETE restrict,
  CHECK (`event_type` IN ('created', 'replaced', 'revealed', 'tested', 'deleted'))
);
--> statement-breakpoint
CREATE INDEX `user_provider_credential_audit_events_owner_created_at_index`
  ON `user_provider_credential_audit_events` (`owner_principal_id`, `created_at`);

--> statement-breakpoint
ALTER TABLE auto_light_quote_offers ADD COLUMN credential_owner_principal_id TEXT REFERENCES identity_principal(id);
--> statement-breakpoint
UPDATE auto_light_quote_offers SET credential_owner_principal_id = (SELECT created_by_principal_id FROM auto_light_quote_requests WHERE id = quote_request_id);
