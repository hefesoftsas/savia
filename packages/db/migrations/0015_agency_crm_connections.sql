CREATE TABLE `agency_crm_connections` (
  `id` TEXT PRIMARY KEY NOT NULL,
  `agency_id` BIGINT NOT NULL,
  `created_by_principal_id` TEXT NOT NULL,
  `provider` TEXT NOT NULL,
  `nango_connection_id` TEXT NOT NULL,
  `nango_integration_id` TEXT NOT NULL,
  `status` TEXT NOT NULL,
  `external_account_label` TEXT,
  `scopes` TEXT NOT NULL DEFAULT '[]',
  `last_validated_at` TEXT,
  `disconnected_at` TEXT,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  FOREIGN KEY (`agency_id`) REFERENCES `agencies`(`id`) ON UPDATE no action ON DELETE restrict,
  FOREIGN KEY (`created_by_principal_id`) REFERENCES `identity_principal`(`id`) ON UPDATE no action ON DELETE restrict,
  CHECK (`provider` IN ('hubspot', 'salesforce', 'zoho', 'pipedrive')),
  CHECK (`status` IN ('pending', 'connected', 'reconnect_required', 'disconnected', 'failed'))
);
--> statement-breakpoint
CREATE INDEX `agency_crm_connections_agency_provider_index`
  ON `agency_crm_connections` (`agency_id`, `provider`);
--> statement-breakpoint
CREATE UNIQUE INDEX `agency_crm_connections_active_unique`
  ON `agency_crm_connections` (`agency_id`, `provider`)
  WHERE `disconnected_at` IS NULL;
--> statement-breakpoint
CREATE TABLE `agency_crm_connection_audit_events` (
  `id` TEXT PRIMARY KEY NOT NULL,
  `connection_id` TEXT NOT NULL,
  `agency_id` BIGINT NOT NULL,
  `principal_id` TEXT NOT NULL,
  `provider` TEXT NOT NULL,
  `event_type` TEXT NOT NULL,
  `outcome` TEXT NOT NULL,
  `error_code` TEXT,
  `created_at` TEXT NOT NULL,
  FOREIGN KEY (`connection_id`) REFERENCES `agency_crm_connections`(`id`) ON UPDATE no action ON DELETE restrict,
  FOREIGN KEY (`agency_id`) REFERENCES `agencies`(`id`) ON UPDATE no action ON DELETE restrict,
  FOREIGN KEY (`principal_id`) REFERENCES `identity_principal`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `agency_crm_connection_audit_events_connection_created_at_index`
  ON `agency_crm_connection_audit_events` (`connection_id`, `created_at`);
--> statement-breakpoint
CREATE INDEX `agency_crm_connection_audit_events_agency_created_at_index`
  ON `agency_crm_connection_audit_events` (`agency_id`, `created_at`);
