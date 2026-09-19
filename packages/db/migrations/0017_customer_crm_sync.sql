ALTER TABLE `agency_crm_connections`
  ADD COLUMN `external_account_id` TEXT;
--> statement-breakpoint
CREATE TABLE `customer_crm_sync_records` (
  `agency_id` BIGINT NOT NULL,
  `customer_profile_id` BIGINT NOT NULL,
  `provider` TEXT NOT NULL,
  `object_kind` TEXT NOT NULL,
  `external_object_id` TEXT NOT NULL,
  `last_synced_at` TEXT,
  `last_failure_code` TEXT,
  `last_failure_at` TEXT,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  PRIMARY KEY (`agency_id`, `customer_profile_id`, `provider`, `object_kind`),
  FOREIGN KEY (`agency_id`) REFERENCES `agencies`(`id`) ON UPDATE no action ON DELETE restrict,
  FOREIGN KEY (`customer_profile_id`) REFERENCES `customer_clientagency`(`id`) ON UPDATE no action ON DELETE restrict,
  CHECK (`provider` IN ('hubspot', 'salesforce', 'zoho', 'pipedrive')),
  CHECK (`object_kind` IN ('contact', 'company'))
);
--> statement-breakpoint
CREATE INDEX `customer_crm_sync_records_customer_provider_index`
  ON `customer_crm_sync_records` (`customer_profile_id`, `provider`);
