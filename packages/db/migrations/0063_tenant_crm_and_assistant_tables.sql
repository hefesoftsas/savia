ALTER TABLE `agency_crm_connections` RENAME COLUMN `agency_id` TO `tenant_id`;
--> statement-breakpoint
ALTER TABLE `agency_crm_connections` RENAME TO `tenant_crm_connections`;
--> statement-breakpoint
DROP INDEX IF EXISTS `agency_crm_connections_agency_provider_index`;
--> statement-breakpoint
CREATE INDEX `tenant_crm_connections_tenant_provider_index`
  ON `tenant_crm_connections` (`tenant_id`, `provider`);
--> statement-breakpoint
DROP INDEX IF EXISTS `agency_crm_connections_owner_index`;
--> statement-breakpoint
CREATE INDEX `tenant_crm_connections_owner_index`
  ON `tenant_crm_connections` (`created_by_principal_id`, `tenant_id`, `provider`);
--> statement-breakpoint
DROP INDEX IF EXISTS `agency_crm_connections_active_unique`;
--> statement-breakpoint
CREATE UNIQUE INDEX `tenant_crm_connections_active_unique`
  ON `tenant_crm_connections` (`created_by_principal_id`, `tenant_id`, `provider`)
  WHERE `disconnected_at` IS NULL;
--> statement-breakpoint
ALTER TABLE `agency_crm_connection_audit_events` RENAME COLUMN `agency_id` TO `tenant_id`;
--> statement-breakpoint
ALTER TABLE `agency_crm_connection_audit_events` RENAME TO `tenant_crm_connection_audit_events`;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `tenant_crm_connection_audit_events_connection_created_at_index`
  ON `tenant_crm_connection_audit_events` (`connection_id`, `created_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `tenant_crm_connection_audit_events_tenant_created_at_index`
  ON `tenant_crm_connection_audit_events` (`tenant_id`, `created_at`);
--> statement-breakpoint
ALTER TABLE `assistant_active_agencies` RENAME COLUMN `agency_id` TO `tenant_id`;
--> statement-breakpoint
ALTER TABLE `assistant_active_agencies` RENAME TO `assistant_active_tenants`;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `assistant_active_tenants_tenant_index`
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
