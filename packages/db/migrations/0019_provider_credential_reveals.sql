CREATE TABLE `agency_provider_credential_audit_events_next` (
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
  CHECK (`event_type` IN ('created', 'replaced', 'revealed', 'tested', 'deleted'))
);
--> statement-breakpoint
INSERT INTO `agency_provider_credential_audit_events_next` (
  `id`, `agency_id`, `provider`, `actor_principal_id`, `event_type`,
  `outcome`, `error_code`, `created_at`
)
SELECT
  `id`, `agency_id`, `provider`, `actor_principal_id`, `event_type`,
  `outcome`, `error_code`, `created_at`
FROM `agency_provider_credential_audit_events`;
--> statement-breakpoint
DROP TABLE `agency_provider_credential_audit_events`;
--> statement-breakpoint
ALTER TABLE `agency_provider_credential_audit_events_next`
  RENAME TO `agency_provider_credential_audit_events`;
--> statement-breakpoint
CREATE INDEX `agency_provider_credential_audit_events_agency_created_at_index`
  ON `agency_provider_credential_audit_events` (`agency_id`, `created_at`);
