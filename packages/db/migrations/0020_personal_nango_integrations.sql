CREATE TABLE `personal_integration_connections` (
  `id` TEXT PRIMARY KEY NOT NULL,
  `principal_id` TEXT NOT NULL,
  `provider` TEXT NOT NULL,
  `nango_connection_id` TEXT NOT NULL,
  `nango_integration_id` TEXT NOT NULL,
  `status` TEXT NOT NULL,
  `external_account_label` TEXT,
  `external_account_id` TEXT,
  `scopes` TEXT NOT NULL DEFAULT '[]',
  `last_validated_at` TEXT,
  `disconnected_at` TEXT,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  FOREIGN KEY (`principal_id`) REFERENCES `identity_principal`(`id`) ON UPDATE no action ON DELETE restrict,
  CHECK (`provider` IN ('google_drive', 'gmail', 'google_calendar', 'outlook', 'onedrive_personal', 'onedrive_business')),
  CHECK (`status` IN ('pending', 'connected', 'reconnect_required', 'disconnected', 'failed'))
);
--> statement-breakpoint
CREATE INDEX `personal_integration_connections_principal_provider_index`
  ON `personal_integration_connections` (`principal_id`, `provider`);
--> statement-breakpoint
CREATE UNIQUE INDEX `personal_integration_connections_active_unique`
  ON `personal_integration_connections` (`principal_id`, `provider`)
  WHERE `disconnected_at` IS NULL;
--> statement-breakpoint
CREATE TABLE `personal_integration_audit_events` (
  `id` TEXT PRIMARY KEY NOT NULL,
  `connection_id` TEXT NOT NULL,
  `principal_id` TEXT NOT NULL,
  `provider` TEXT NOT NULL,
  `event_type` TEXT NOT NULL,
  `outcome` TEXT NOT NULL,
  `error_code` TEXT,
  `created_at` TEXT NOT NULL,
  FOREIGN KEY (`connection_id`) REFERENCES `personal_integration_connections`(`id`) ON UPDATE no action ON DELETE restrict,
  FOREIGN KEY (`principal_id`) REFERENCES `identity_principal`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `personal_integration_audit_events_connection_created_at_index`
  ON `personal_integration_audit_events` (`connection_id`, `created_at`);
--> statement-breakpoint
CREATE INDEX `personal_integration_audit_events_principal_created_at_index`
  ON `personal_integration_audit_events` (`principal_id`, `created_at`);
