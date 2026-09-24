-- Repair + converge the customer sync tables after the retired rebuild plan.
-- The original 0071 (rebuild without legacy FKs) proved undeployable: D1 applies one
-- statement per request, so deferred FKs cannot cover dropping a table that live rows
-- still reference. That file never completed anywhere and was never marked applied, so
-- this replacement replays cleanly from scratch on every database, including the one
-- preview database that absorbed its partial prefix (restaged triggers, one FK deviation).
-- What this does, idempotently and safe with data, statement by statement:
--   * drop leftover __stg/__new staging tables from the retired attempt;
--   * evacuate customer_legalpersoncontact aside (it references nothing) so that
--     customer_legalperson (referenced only by it) can be dropped and recreated with
--     its ORIGINAL definition including the business_activity_id FK, restoring exact
--     pre-0071 parity on every database;
--   * recreate that table's original indexes and all 13 CRM sync triggers byte-identical
--     from 0042/0006 (the partial run had dropped 3 trigger sets without recreating them).
-- The 4 retired FK parents (customer_client, customer_group, business_commercialunit,
-- app_economicactivity) STAY: removing their constraints requires rebuilding live tables,
-- which D1's per-statement application cannot do without data loss. Legacy total: 9 kept.
-- See docs/superpowers/plans/2026-09-24-legacy-tables-cleanup.md.
DROP TABLE IF EXISTS `customer_legalpersoncontact__stg`;
--> statement-breakpoint
DROP TABLE IF EXISTS `customer_legalpersoncontact__new`;
--> statement-breakpoint
DROP TABLE IF EXISTS `customer_naturalperson__stg`;
--> statement-breakpoint
DROP TABLE IF EXISTS `customer_naturalperson__new`;
--> statement-breakpoint
DROP TABLE IF EXISTS `customer_legalperson__stg`;
--> statement-breakpoint
DROP TABLE IF EXISTS `customer_legalperson__new`;
--> statement-breakpoint
DROP TABLE IF EXISTS `customer_clientagency__stg`;
--> statement-breakpoint
DROP TABLE IF EXISTS `customer_clientagency__new`;
--> statement-breakpoint
DROP TABLE IF EXISTS `customer_address__stg`;
--> statement-breakpoint
DROP TABLE IF EXISTS `customer_address__new`;
--> statement-breakpoint
CREATE TABLE `customer_legalpersoncontact__stg` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `surname` TEXT NOT NULL,
  `email` TEXT NOT NULL,
  `phone` TEXT NOT NULL,
  `position` TEXT NOT NULL,
  `legal_person_id` BIGINT NOT NULL,
  `is_main` INTEGER NOT NULL,
  `name` TEXT NOT NULL,
  `comments` TEXT NOT NULL);
--> statement-breakpoint
INSERT INTO `customer_legalpersoncontact__stg` SELECT * FROM `customer_legalpersoncontact`;
--> statement-breakpoint
DROP TABLE `customer_legalpersoncontact`;
--> statement-breakpoint
CREATE TABLE `customer_legalperson__stg` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `name` TEXT NOT NULL,
  `id_number` TEXT NOT NULL,
  `id_check_digit` TEXT NOT NULL,
  `incorporation_date` TEXT,
  `lr_name` TEXT NOT NULL,
  `lr_id_type` TEXT NOT NULL,
  `lr_id_number` TEXT NOT NULL,
  `address_id` BIGINT,
  `business_activity_id` INTEGER,
  `client_id` BIGINT NOT NULL);
--> statement-breakpoint
INSERT INTO `customer_legalperson__stg` SELECT * FROM `customer_legalperson`;
--> statement-breakpoint
DROP TABLE `customer_legalperson`;
--> statement-breakpoint
CREATE TABLE `customer_legalperson` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `name` TEXT NOT NULL,
  `id_number` TEXT NOT NULL,
  `id_check_digit` TEXT NOT NULL,
  `incorporation_date` TEXT,
  `lr_name` TEXT NOT NULL,
  `lr_id_type` TEXT NOT NULL,
  `lr_id_number` TEXT NOT NULL,
  `address_id` BIGINT,
  `business_activity_id` INTEGER,
  `client_id` BIGINT NOT NULL,
  CONSTRAINT `customer_legalperson_address_id_93d0acf3_fk_customer_address_id` FOREIGN KEY (`address_id`) REFERENCES `customer_address` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `customer_legalperson_business_activity_id_fbcde3c5_fk_app_econo` FOREIGN KEY (`business_activity_id`) REFERENCES `app_economicactivity` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `customer_legalperson_client_id_4bf9637a_fk_customer_` FOREIGN KEY (`client_id`) REFERENCES `customer_clientagency` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
INSERT INTO `customer_legalperson` SELECT * FROM `customer_legalperson__stg`;
--> statement-breakpoint
DROP TABLE `customer_legalperson__stg`;
--> statement-breakpoint
CREATE INDEX `customer_legalperson_address_id_93d0acf3` ON `customer_legalperson` (`address_id`);
--> statement-breakpoint
CREATE INDEX `customer_legalperson_business_activity_id_fbcde3c5` ON `customer_legalperson` (`business_activity_id`);
--> statement-breakpoint
CREATE INDEX `customer_legalperson_client_agency_id_3baf8ef1` ON `customer_legalperson` (`client_id`);
--> statement-breakpoint
CREATE INDEX `customer_legalperson_id_slug_7402ef0d_like` ON `customer_legalperson` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `customer_legalperson_id_slug_key` ON `customer_legalperson` (`id_slug`);
--> statement-breakpoint
CREATE INDEX `customer_legalperson_lr_id_type_df272121` ON `customer_legalperson` (`lr_id_type`);
--> statement-breakpoint
CREATE INDEX `customer_legalperson_lr_id_type_df272121_like` ON `customer_legalperson` (`lr_id_type`);
--> statement-breakpoint
CREATE TABLE `customer_legalpersoncontact` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `surname` TEXT NOT NULL,
  `email` TEXT NOT NULL,
  `phone` TEXT NOT NULL,
  `position` TEXT NOT NULL,
  `legal_person_id` BIGINT NOT NULL,
  `is_main` INTEGER NOT NULL,
  `name` TEXT NOT NULL,
  `comments` TEXT NOT NULL,
  CONSTRAINT `customer_legalperson_legal_person_id_af37b447_fk_customer_` FOREIGN KEY (`legal_person_id`) REFERENCES `customer_legalperson` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
INSERT INTO `customer_legalpersoncontact` SELECT * FROM `customer_legalpersoncontact__stg`;
--> statement-breakpoint
DROP TABLE `customer_legalpersoncontact__stg`;
--> statement-breakpoint
CREATE INDEX `customer_legalpersoncontact_id_slug_4fbb0989_like` ON `customer_legalpersoncontact` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `customer_legalpersoncontact_id_slug_key` ON `customer_legalpersoncontact` (`id_slug`);
--> statement-breakpoint
CREATE INDEX `customer_legalpersoncontact_legal_person_id_af37b447` ON `customer_legalpersoncontact` (`legal_person_id`);
--> statement-breakpoint
DROP TRIGGER IF EXISTS `crm_sync_customer_naturalperson_insert`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `crm_sync_customer_naturalperson_update`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `crm_sync_customer_legalperson_insert`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `crm_sync_customer_legalperson_update`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `crm_sync_customer_clientagency_insert`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `crm_sync_customer_clientagency_update`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `crm_sync_customer_deleted`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `crm_sync_customer_address_insert`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `crm_sync_customer_address_update`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `crm_sync_customer_address_delete`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `crm_sync_customer_legalpersoncontact_insert`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `crm_sync_customer_legalpersoncontact_update`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `crm_sync_customer_legalpersoncontact_delete`;
--> statement-breakpoint
CREATE TRIGGER crm_sync_customer_naturalperson_insert AFTER INSERT ON customer_naturalperson
BEGIN
 INSERT INTO crm_sync_jobs(id,rule_id,customer_id)
 SELECT r.id || ':' || p.id,r.id,p.id FROM crm_sync_rules r JOIN customer_clientagency p ON p.agency_id=r.tenant_id
 WHERE r.enabled=1 AND p.id=NEW.client_id
 ON CONFLICT(rule_id,customer_id) DO UPDATE SET
 revision=revision+1,
 status=CASE WHEN status='processing' OR (status='blocked' AND COALESCE(last_error,'')<>'RULE_PAUSED') THEN status ELSE 'pending' END,
 attempts=CASE WHEN status='processing' OR (status='blocked' AND COALESCE(last_error,'')<>'RULE_PAUSED') THEN attempts ELSE 0 END,
 last_error=CASE WHEN status='processing' OR (status='blocked' AND COALESCE(last_error,'')<>'RULE_PAUSED') THEN last_error ELSE NULL END,
 next_attempt_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
 updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now');
END;
--> statement-breakpoint
CREATE TRIGGER crm_sync_customer_naturalperson_update AFTER UPDATE ON customer_naturalperson
BEGIN
 INSERT INTO crm_sync_jobs(id,rule_id,customer_id)
 SELECT r.id || ':' || p.id,r.id,p.id FROM crm_sync_rules r JOIN customer_clientagency p ON p.agency_id=r.tenant_id
 WHERE r.enabled=1 AND p.id=NEW.client_id
 ON CONFLICT(rule_id,customer_id) DO UPDATE SET
 revision=revision+1,
 status=CASE WHEN status='processing' OR (status='blocked' AND COALESCE(last_error,'')<>'RULE_PAUSED') THEN status ELSE 'pending' END,
 attempts=CASE WHEN status='processing' OR (status='blocked' AND COALESCE(last_error,'')<>'RULE_PAUSED') THEN attempts ELSE 0 END,
 last_error=CASE WHEN status='processing' OR (status='blocked' AND COALESCE(last_error,'')<>'RULE_PAUSED') THEN last_error ELSE NULL END,
 next_attempt_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
 updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now');
END;
--> statement-breakpoint
CREATE TRIGGER crm_sync_customer_legalperson_insert AFTER INSERT ON customer_legalperson
BEGIN
 INSERT INTO crm_sync_jobs(id,rule_id,customer_id)
 SELECT r.id || ':' || p.id,r.id,p.id FROM crm_sync_rules r JOIN customer_clientagency p ON p.agency_id=r.tenant_id
 WHERE r.enabled=1 AND p.id=NEW.client_id
 ON CONFLICT(rule_id,customer_id) DO UPDATE SET
 revision=revision+1,
 status=CASE WHEN status='processing' OR (status='blocked' AND COALESCE(last_error,'')<>'RULE_PAUSED') THEN status ELSE 'pending' END,
 attempts=CASE WHEN status='processing' OR (status='blocked' AND COALESCE(last_error,'')<>'RULE_PAUSED') THEN attempts ELSE 0 END,
 last_error=CASE WHEN status='processing' OR (status='blocked' AND COALESCE(last_error,'')<>'RULE_PAUSED') THEN last_error ELSE NULL END,
 next_attempt_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
 updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now');
END;
--> statement-breakpoint
CREATE TRIGGER crm_sync_customer_legalperson_update AFTER UPDATE ON customer_legalperson
BEGIN
 INSERT INTO crm_sync_jobs(id,rule_id,customer_id)
 SELECT r.id || ':' || p.id,r.id,p.id FROM crm_sync_rules r JOIN customer_clientagency p ON p.agency_id=r.tenant_id
 WHERE r.enabled=1 AND p.id=NEW.client_id
 ON CONFLICT(rule_id,customer_id) DO UPDATE SET
 revision=revision+1,
 status=CASE WHEN status='processing' OR (status='blocked' AND COALESCE(last_error,'')<>'RULE_PAUSED') THEN status ELSE 'pending' END,
 attempts=CASE WHEN status='processing' OR (status='blocked' AND COALESCE(last_error,'')<>'RULE_PAUSED') THEN attempts ELSE 0 END,
 last_error=CASE WHEN status='processing' OR (status='blocked' AND COALESCE(last_error,'')<>'RULE_PAUSED') THEN last_error ELSE NULL END,
 next_attempt_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
 updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now');
END;
--> statement-breakpoint
CREATE TRIGGER crm_sync_customer_clientagency_insert AFTER INSERT ON customer_clientagency
BEGIN
 INSERT INTO crm_sync_jobs(id,rule_id,customer_id)
 SELECT r.id || ':' || p.id,r.id,p.id FROM crm_sync_rules r JOIN customer_clientagency p ON p.agency_id=r.tenant_id
 WHERE r.enabled=1 AND p.id=NEW.id
 ON CONFLICT(rule_id,customer_id) DO UPDATE SET
 revision=revision+1,
 status=CASE WHEN status='processing' OR (status='blocked' AND COALESCE(last_error,'')<>'RULE_PAUSED') THEN status ELSE 'pending' END,
 attempts=CASE WHEN status='processing' OR (status='blocked' AND COALESCE(last_error,'')<>'RULE_PAUSED') THEN attempts ELSE 0 END,
 last_error=CASE WHEN status='processing' OR (status='blocked' AND COALESCE(last_error,'')<>'RULE_PAUSED') THEN last_error ELSE NULL END,
 next_attempt_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
 updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now');
END;
--> statement-breakpoint
CREATE TRIGGER crm_sync_customer_clientagency_update AFTER UPDATE ON customer_clientagency
BEGIN
 INSERT INTO crm_sync_jobs(id,rule_id,customer_id)
 SELECT r.id || ':' || p.id,r.id,p.id FROM crm_sync_rules r JOIN customer_clientagency p ON p.agency_id=r.tenant_id
 WHERE r.enabled=1 AND p.id=NEW.id
 ON CONFLICT(rule_id,customer_id) DO UPDATE SET
 revision=revision+1,
 status=CASE WHEN status='processing' OR (status='blocked' AND COALESCE(last_error,'')<>'RULE_PAUSED') THEN status ELSE 'pending' END,
 attempts=CASE WHEN status='processing' OR (status='blocked' AND COALESCE(last_error,'')<>'RULE_PAUSED') THEN attempts ELSE 0 END,
 last_error=CASE WHEN status='processing' OR (status='blocked' AND COALESCE(last_error,'')<>'RULE_PAUSED') THEN last_error ELSE NULL END,
 next_attempt_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
 updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now');
END;
--> statement-breakpoint
CREATE TRIGGER crm_sync_customer_deleted AFTER DELETE ON customer_clientagency
BEGIN
 UPDATE crm_sync_jobs SET revision=revision+1,status='blocked',last_error='SOURCE_DELETED',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE customer_id=OLD.id;
END;
--> statement-breakpoint
CREATE TRIGGER crm_sync_customer_address_insert AFTER INSERT ON customer_address
BEGIN
 INSERT INTO crm_sync_jobs(id,rule_id,customer_id)
 SELECT r.id || ':' || p.id,r.id,p.id FROM crm_sync_rules r JOIN customer_clientagency p ON p.agency_id=r.tenant_id
 WHERE r.enabled=1 AND p.id IN (SELECT client_id FROM customer_naturalperson WHERE home_address_id=NEW.id)
 ON CONFLICT(rule_id,customer_id) DO UPDATE SET revision=revision+1,
 status=CASE WHEN status='processing' OR (status='blocked' AND COALESCE(last_error,'')<>'RULE_PAUSED') THEN status ELSE 'pending' END,
 attempts=CASE WHEN status='processing' OR (status='blocked' AND COALESCE(last_error,'')<>'RULE_PAUSED') THEN attempts ELSE 0 END,
 last_error=CASE WHEN status='processing' OR (status='blocked' AND COALESCE(last_error,'')<>'RULE_PAUSED') THEN last_error ELSE NULL END,
 next_attempt_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now');
END;
--> statement-breakpoint
CREATE TRIGGER crm_sync_customer_address_update AFTER UPDATE ON customer_address
BEGIN
 INSERT INTO crm_sync_jobs(id,rule_id,customer_id)
 SELECT r.id || ':' || p.id,r.id,p.id FROM crm_sync_rules r JOIN customer_clientagency p ON p.agency_id=r.tenant_id
 WHERE r.enabled=1 AND p.id IN (SELECT client_id FROM customer_naturalperson WHERE home_address_id=NEW.id)
 ON CONFLICT(rule_id,customer_id) DO UPDATE SET revision=revision+1,
 status=CASE WHEN status='processing' OR (status='blocked' AND COALESCE(last_error,'')<>'RULE_PAUSED') THEN status ELSE 'pending' END,
 attempts=CASE WHEN status='processing' OR (status='blocked' AND COALESCE(last_error,'')<>'RULE_PAUSED') THEN attempts ELSE 0 END,
 last_error=CASE WHEN status='processing' OR (status='blocked' AND COALESCE(last_error,'')<>'RULE_PAUSED') THEN last_error ELSE NULL END,
 next_attempt_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now');
END;
--> statement-breakpoint
CREATE TRIGGER crm_sync_customer_address_delete AFTER DELETE ON customer_address
BEGIN
 INSERT INTO crm_sync_jobs(id,rule_id,customer_id)
 SELECT r.id || ':' || p.id,r.id,p.id FROM crm_sync_rules r JOIN customer_clientagency p ON p.agency_id=r.tenant_id
 WHERE r.enabled=1 AND p.id IN (SELECT client_id FROM customer_naturalperson WHERE home_address_id=OLD.id)
 ON CONFLICT(rule_id,customer_id) DO UPDATE SET revision=revision+1,
 status=CASE WHEN status='processing' OR (status='blocked' AND COALESCE(last_error,'')<>'RULE_PAUSED') THEN status ELSE 'pending' END,
 attempts=CASE WHEN status='processing' OR (status='blocked' AND COALESCE(last_error,'')<>'RULE_PAUSED') THEN attempts ELSE 0 END,
 last_error=CASE WHEN status='processing' OR (status='blocked' AND COALESCE(last_error,'')<>'RULE_PAUSED') THEN last_error ELSE NULL END,
 next_attempt_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now');
END;
--> statement-breakpoint
CREATE TRIGGER crm_sync_customer_legalpersoncontact_insert AFTER INSERT ON customer_legalpersoncontact
BEGIN
 INSERT INTO crm_sync_jobs(id,rule_id,customer_id)
 SELECT r.id || ':' || p.id,r.id,p.id FROM crm_sync_rules r JOIN customer_clientagency p ON p.agency_id=r.tenant_id
 WHERE r.enabled=1 AND p.id IN (SELECT client_id FROM customer_legalperson WHERE id=NEW.legal_person_id)
 ON CONFLICT(rule_id,customer_id) DO UPDATE SET revision=revision+1,
 status=CASE WHEN status='processing' OR (status='blocked' AND COALESCE(last_error,'')<>'RULE_PAUSED') THEN status ELSE 'pending' END,
 attempts=CASE WHEN status='processing' OR (status='blocked' AND COALESCE(last_error,'')<>'RULE_PAUSED') THEN attempts ELSE 0 END,
 last_error=CASE WHEN status='processing' OR (status='blocked' AND COALESCE(last_error,'')<>'RULE_PAUSED') THEN last_error ELSE NULL END,
 next_attempt_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now');
END;
--> statement-breakpoint
CREATE TRIGGER crm_sync_customer_legalpersoncontact_update AFTER UPDATE ON customer_legalpersoncontact
BEGIN
 INSERT INTO crm_sync_jobs(id,rule_id,customer_id)
 SELECT r.id || ':' || p.id,r.id,p.id FROM crm_sync_rules r JOIN customer_clientagency p ON p.agency_id=r.tenant_id
 WHERE r.enabled=1 AND p.id IN (SELECT client_id FROM customer_legalperson WHERE id=NEW.legal_person_id)
 ON CONFLICT(rule_id,customer_id) DO UPDATE SET revision=revision+1,
 status=CASE WHEN status='processing' OR (status='blocked' AND COALESCE(last_error,'')<>'RULE_PAUSED') THEN status ELSE 'pending' END,
 attempts=CASE WHEN status='processing' OR (status='blocked' AND COALESCE(last_error,'')<>'RULE_PAUSED') THEN attempts ELSE 0 END,
 last_error=CASE WHEN status='processing' OR (status='blocked' AND COALESCE(last_error,'')<>'RULE_PAUSED') THEN last_error ELSE NULL END,
 next_attempt_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now');
END;
--> statement-breakpoint
CREATE TRIGGER crm_sync_customer_legalpersoncontact_delete AFTER DELETE ON customer_legalpersoncontact
BEGIN
 INSERT INTO crm_sync_jobs(id,rule_id,customer_id)
 SELECT r.id || ':' || p.id,r.id,p.id FROM crm_sync_rules r JOIN customer_clientagency p ON p.agency_id=r.tenant_id
 WHERE r.enabled=1 AND p.id IN (SELECT client_id FROM customer_legalperson WHERE id=OLD.legal_person_id)
 ON CONFLICT(rule_id,customer_id) DO UPDATE SET revision=revision+1,
 status=CASE WHEN status='processing' OR (status='blocked' AND COALESCE(last_error,'')<>'RULE_PAUSED') THEN status ELSE 'pending' END,
 attempts=CASE WHEN status='processing' OR (status='blocked' AND COALESCE(last_error,'')<>'RULE_PAUSED') THEN attempts ELSE 0 END,
 last_error=CASE WHEN status='processing' OR (status='blocked' AND COALESCE(last_error,'')<>'RULE_PAUSED') THEN last_error ELSE NULL END,
 next_attempt_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now');
END;
