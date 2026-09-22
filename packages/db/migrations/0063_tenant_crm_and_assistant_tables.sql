PRAGMA defer_foreign_keys = ON;
--> statement-breakpoint
CREATE TABLE `tenant_crm_connections` (
  `id` TEXT PRIMARY KEY NOT NULL,
  `tenant_id` BIGINT NOT NULL REFERENCES `tenants`(`id`),
  `created_by_principal_id` TEXT NOT NULL REFERENCES `identity_principal`(`id`),
  `provider` TEXT NOT NULL CHECK(`provider` IN ('hubspot','salesforce','zoho','pipedrive')),
  `nango_connection_id` TEXT NOT NULL,
  `nango_integration_id` TEXT NOT NULL,
  `status` TEXT NOT NULL CHECK(`status` IN ('pending','connected','reconnect_required','disconnected','failed')),
  `external_account_label` TEXT,
  `scopes` TEXT NOT NULL DEFAULT '[]',
  `last_validated_at` TEXT,
  `disconnected_at` TEXT,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `external_account_id` TEXT
);
--> statement-breakpoint
INSERT INTO `tenant_crm_connections` (
  `id`, `tenant_id`, `created_by_principal_id`, `provider`,
  `nango_connection_id`, `nango_integration_id`, `status`,
  `external_account_label`, `scopes`, `last_validated_at`,
  `disconnected_at`, `created_at`, `updated_at`, `external_account_id`
)
SELECT
  `id`, `agency_id`, `created_by_principal_id`, `provider`,
  `nango_connection_id`, `nango_integration_id`, `status`,
  `external_account_label`, `scopes`, `last_validated_at`,
  `disconnected_at`, `created_at`, `updated_at`, `external_account_id`
FROM `agency_crm_connections`;
--> statement-breakpoint
DROP TABLE `agency_crm_connections`;
--> statement-breakpoint
CREATE INDEX `tenant_crm_connections_tenant_provider_index`
  ON `tenant_crm_connections` (`tenant_id`, `provider`);
--> statement-breakpoint
CREATE INDEX `tenant_crm_connections_owner_index`
  ON `tenant_crm_connections` (`created_by_principal_id`, `tenant_id`, `provider`);
--> statement-breakpoint
CREATE UNIQUE INDEX `tenant_crm_connections_active_unique`
  ON `tenant_crm_connections` (`created_by_principal_id`, `tenant_id`, `provider`)
  WHERE `disconnected_at` IS NULL;
--> statement-breakpoint
CREATE TABLE `tenant_crm_connection_audit_events` (
  `id` TEXT PRIMARY KEY NOT NULL,
  `connection_id` TEXT NOT NULL REFERENCES `tenant_crm_connections`(`id`),
  `tenant_id` BIGINT NOT NULL REFERENCES `tenants`(`id`),
  `principal_id` TEXT NOT NULL REFERENCES `identity_principal`(`id`),
  `provider` TEXT NOT NULL,
  `event_type` TEXT NOT NULL,
  `outcome` TEXT NOT NULL,
  `error_code` TEXT,
  `created_at` TEXT NOT NULL
);
--> statement-breakpoint
INSERT INTO `tenant_crm_connection_audit_events` (
  `id`, `connection_id`, `tenant_id`, `principal_id`, `provider`,
  `event_type`, `outcome`, `error_code`, `created_at`
)
SELECT
  `id`, `connection_id`, `agency_id`, `principal_id`, `provider`,
  `event_type`, `outcome`, `error_code`, `created_at`
FROM `agency_crm_connection_audit_events`;
--> statement-breakpoint
DROP TABLE `agency_crm_connection_audit_events`;
--> statement-breakpoint
CREATE INDEX `tenant_crm_connection_audit_events_connection_created_at_index`
  ON `tenant_crm_connection_audit_events` (`connection_id`, `created_at`);
--> statement-breakpoint
CREATE INDEX `tenant_crm_connection_audit_events_tenant_created_at_index`
  ON `tenant_crm_connection_audit_events` (`tenant_id`, `created_at`);
--> statement-breakpoint
CREATE TABLE `crm_sync_rules_backup` AS SELECT * FROM `crm_sync_rules`;
--> statement-breakpoint
DROP TABLE `crm_sync_rules`;
--> statement-breakpoint
CREATE TABLE `crm_sync_rules` (
  `id` TEXT PRIMARY KEY,
  `principal_id` TEXT NOT NULL REFERENCES `identity_principal`(`id`),
  `tenant_id` INTEGER NOT NULL REFERENCES `tenants`(`id`),
  `provider` TEXT NOT NULL CHECK(`provider` IN ('hubspot','salesforce','zoho','pipedrive')),
  `connection_id` TEXT NOT NULL REFERENCES `tenant_crm_connections`(`id`),
  `external_account_id` TEXT NOT NULL,
  `account_label` TEXT NOT NULL,
  `enabled` INTEGER NOT NULL DEFAULT 1 CHECK(`enabled` IN (0,1)),
  `created_at` TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(`principal_id`, `tenant_id`, `provider`, `connection_id`, `external_account_id`)
);
--> statement-breakpoint
INSERT INTO `crm_sync_rules` SELECT * FROM `crm_sync_rules_backup`;
--> statement-breakpoint
DROP TABLE `crm_sync_rules_backup`;
--> statement-breakpoint
CREATE TABLE `assistant_active_tenants` (
  `principal_id` TEXT PRIMARY KEY NOT NULL REFERENCES `identity_principal`(`id`) ON DELETE CASCADE,
  `tenant_id` BIGINT NOT NULL REFERENCES `tenants`(`id`) ON DELETE CASCADE,
  `updated_at` TEXT NOT NULL
);
--> statement-breakpoint
INSERT INTO `assistant_active_tenants` (`principal_id`, `tenant_id`, `updated_at`)
SELECT `principal_id`, `agency_id`, `updated_at`
FROM `assistant_active_agencies`;
--> statement-breakpoint
DROP TABLE `assistant_active_agencies`;
--> statement-breakpoint
CREATE INDEX `assistant_active_tenants_tenant_index`
  ON `assistant_active_tenants` (`tenant_id`);
--> statement-breakpoint
CREATE VIEW `agency_crm_connections` AS
  SELECT `id`, `tenant_id` AS `agency_id`, `created_by_principal_id`, `provider`,
         `nango_connection_id`, `nango_integration_id`, `status`,
         `external_account_label`, `scopes`, `last_validated_at`,
         `disconnected_at`, `created_at`, `updated_at`, `external_account_id`
  FROM `tenant_crm_connections`;
--> statement-breakpoint
CREATE TRIGGER `agency_crm_connections_insert` INSTEAD OF INSERT ON `agency_crm_connections`
BEGIN
  INSERT INTO `tenant_crm_connections` (
    `id`, `tenant_id`, `created_by_principal_id`, `provider`,
    `nango_connection_id`, `nango_integration_id`, `status`,
    `external_account_label`, `scopes`, `last_validated_at`,
    `disconnected_at`, `created_at`, `updated_at`, `external_account_id`
  ) VALUES (
    NEW.`id`, NEW.`agency_id`, NEW.`created_by_principal_id`, NEW.`provider`,
    NEW.`nango_connection_id`, NEW.`nango_integration_id`, NEW.`status`,
    NEW.`external_account_label`, COALESCE(NEW.`scopes`, '[]'), NEW.`last_validated_at`,
    NEW.`disconnected_at`, NEW.`created_at`, NEW.`updated_at`, NEW.`external_account_id`
  );
END;
--> statement-breakpoint
CREATE TRIGGER `agency_crm_connections_update` INSTEAD OF UPDATE ON `agency_crm_connections`
BEGIN
  UPDATE `tenant_crm_connections` SET
    `tenant_id` = NEW.`agency_id`,
    `nango_connection_id` = NEW.`nango_connection_id`,
    `nango_integration_id` = NEW.`nango_integration_id`,
    `status` = NEW.`status`,
    `external_account_label` = NEW.`external_account_label`,
    `external_account_id` = NEW.`external_account_id`,
    `scopes` = COALESCE(NEW.`scopes`, OLD.`scopes`, '[]'),
    `last_validated_at` = NEW.`last_validated_at`,
    `disconnected_at` = NEW.`disconnected_at`,
    `updated_at` = NEW.`updated_at`
  WHERE `id` = OLD.`id`;
END;
--> statement-breakpoint
CREATE TRIGGER `agency_crm_connections_delete` INSTEAD OF DELETE ON `agency_crm_connections`
BEGIN
  DELETE FROM `tenant_crm_connections` WHERE `id` = OLD.`id`;
END;
--> statement-breakpoint
CREATE VIEW `agency_crm_connection_audit_events` AS
  SELECT `id`, `connection_id`, `tenant_id` AS `agency_id`, `principal_id`, `provider`,
         `event_type`, `outcome`, `error_code`, `created_at`
  FROM `tenant_crm_connection_audit_events`;
--> statement-breakpoint
CREATE TRIGGER `agency_crm_connection_audit_events_insert` INSTEAD OF INSERT ON `agency_crm_connection_audit_events`
BEGIN
  INSERT INTO `tenant_crm_connection_audit_events` (
    `id`, `connection_id`, `tenant_id`, `principal_id`, `provider`,
    `event_type`, `outcome`, `error_code`, `created_at`
  ) VALUES (
    NEW.`id`, NEW.`connection_id`, NEW.`agency_id`, NEW.`principal_id`, NEW.`provider`,
    NEW.`event_type`, NEW.`outcome`, NEW.`error_code`, NEW.`created_at`
  );
END;
--> statement-breakpoint
CREATE VIEW `assistant_active_agencies` AS
  SELECT `principal_id`, `tenant_id` AS `agency_id`, `updated_at`
  FROM `assistant_active_tenants`;
--> statement-breakpoint
CREATE TRIGGER `assistant_active_agencies_insert` INSTEAD OF INSERT ON `assistant_active_agencies`
BEGIN
  INSERT INTO `assistant_active_tenants` (`principal_id`, `tenant_id`, `updated_at`)
  VALUES (NEW.`principal_id`, NEW.`agency_id`, NEW.`updated_at`)
  ON CONFLICT(`principal_id`) DO UPDATE SET
    `tenant_id` = excluded.`tenant_id`,
    `updated_at` = excluded.`updated_at`;
END;
--> statement-breakpoint
CREATE TRIGGER `assistant_active_agencies_delete` INSTEAD OF DELETE ON `assistant_active_agencies`
BEGIN
  DELETE FROM `assistant_active_tenants` WHERE `principal_id` = OLD.`principal_id`;
END;
