-- Rebuild the 5 live customer tables without FK constraints to retired legacy tables,
-- then drop those 4 parents (customer_client, customer_group, business_commercialunit,
-- app_economicactivity). Column sets and data are preserved; only the 4 constraint clauses go.
-- FKs to agencies/cities and between the 5 are kept. Triggers/indexes are recreated byte-identical
-- from 0042/0006. defer_foreign_keys covers the transient DROP/RENAME window in one transaction
-- (official D1 pattern; harmless no-op when applied statement-by-statement on empty databases).
-- See docs/superpowers/plans/2026-09-24-legacy-tables-cleanup.md.
PRAGMA defer_foreign_keys = true;
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
CREATE TABLE `customer_naturalperson__stg` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `surname` TEXT NOT NULL,
  `birth_date` TEXT,
  `phone` TEXT NOT NULL,
  `id_type` TEXT NOT NULL,
  `id_number` TEXT NOT NULL,
  `id_issue_at` TEXT,
  `marital_status` TEXT NOT NULL,
  `occupation` TEXT NOT NULL,
  `company` TEXT NOT NULL,
  `home_address_id` BIGINT,
  `work_address_id` BIGINT,
  `genre` TEXT NOT NULL,
  `name` TEXT NOT NULL,
  `email` TEXT NOT NULL,
  `client_id` BIGINT NOT NULL);
--> statement-breakpoint
INSERT INTO `customer_naturalperson__stg` SELECT * FROM `customer_naturalperson`;
--> statement-breakpoint
DROP TABLE `customer_naturalperson`;
--> statement-breakpoint
CREATE TABLE `customer_naturalperson` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `surname` TEXT NOT NULL,
  `birth_date` TEXT,
  `phone` TEXT NOT NULL,
  `id_type` TEXT NOT NULL,
  `id_number` TEXT NOT NULL,
  `id_issue_at` TEXT,
  `marital_status` TEXT NOT NULL,
  `occupation` TEXT NOT NULL,
  `company` TEXT NOT NULL,
  `home_address_id` BIGINT,
  `work_address_id` BIGINT,
  `genre` TEXT NOT NULL,
  `name` TEXT NOT NULL,
  `email` TEXT NOT NULL,
  `client_id` BIGINT NOT NULL,
  CONSTRAINT `customer_naturalpers_client_id_64a2c072_fk_customer_` FOREIGN KEY (`client_id`) REFERENCES `customer_clientagency` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `customer_naturalpers_home_address_id_94875213_fk_customer_` FOREIGN KEY (`home_address_id`) REFERENCES `customer_address` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `customer_naturalpers_work_address_id_191ca03d_fk_customer_` FOREIGN KEY (`work_address_id`) REFERENCES `customer_address` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
INSERT INTO `customer_naturalperson` SELECT * FROM `customer_naturalperson__stg`;
--> statement-breakpoint
DROP TABLE `customer_naturalperson__stg`;
--> statement-breakpoint
CREATE INDEX `customer_naturalperson_client_agency_id_d669e098` ON `customer_naturalperson` (`client_id`);
--> statement-breakpoint
CREATE INDEX `customer_naturalperson_genre_5fb8d699` ON `customer_naturalperson` (`genre`);
--> statement-breakpoint
CREATE INDEX `customer_naturalperson_genre_5fb8d699_like` ON `customer_naturalperson` (`genre`);
--> statement-breakpoint
CREATE INDEX `customer_naturalperson_home_address_id_94875213` ON `customer_naturalperson` (`home_address_id`);
--> statement-breakpoint
CREATE INDEX `customer_naturalperson_id_slug_745981bd_like` ON `customer_naturalperson` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `customer_naturalperson_id_slug_key` ON `customer_naturalperson` (`id_slug`);
--> statement-breakpoint
CREATE INDEX `customer_naturalperson_id_type_bc04fc36` ON `customer_naturalperson` (`id_type`);
--> statement-breakpoint
CREATE INDEX `customer_naturalperson_id_type_bc04fc36_like` ON `customer_naturalperson` (`id_type`);
--> statement-breakpoint
CREATE INDEX `customer_naturalperson_marital_status_0279a05c` ON `customer_naturalperson` (`marital_status`);
--> statement-breakpoint
CREATE INDEX `customer_naturalperson_marital_status_0279a05c_like` ON `customer_naturalperson` (`marital_status`);
--> statement-breakpoint
CREATE INDEX `customer_naturalperson_work_address_id_191ca03d` ON `customer_naturalperson` (`work_address_id`);
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
CREATE TABLE `customer_address__stg` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `address` TEXT NOT NULL,
  `city_id` INTEGER NOT NULL,
  `coordinates` TEXT,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `complement` TEXT NOT NULL);
--> statement-breakpoint
INSERT INTO `customer_address__stg` SELECT * FROM `customer_address`;
--> statement-breakpoint
DROP TABLE `customer_address`;
--> statement-breakpoint
CREATE TABLE `customer_address` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `address` TEXT NOT NULL,
  `city_id` INTEGER NOT NULL,
  `coordinates` TEXT,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `complement` TEXT NOT NULL,
  CONSTRAINT `customer_address_city_id_121281ad_fk_app_city_id` FOREIGN KEY (`city_id`) REFERENCES `cities` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
INSERT INTO `customer_address` SELECT * FROM `customer_address__stg`;
--> statement-breakpoint
DROP TABLE `customer_address__stg`;
--> statement-breakpoint
CREATE INDEX `customer_address_city_id_121281ad` ON `customer_address` (`city_id`);
--> statement-breakpoint
CREATE INDEX `customer_address_coordinates_0b250f3d_id` ON `customer_address` (`coordinates`);
--> statement-breakpoint
CREATE TABLE `customer_clientagency__stg` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `agency_id` BIGINT NOT NULL,
  `client_id` BIGINT NOT NULL,
  `created_by` TEXT NOT NULL,
  `created_by_slug` TEXT NOT NULL,
  `birthday_notification` INTEGER NOT NULL,
  `payment_notification` INTEGER NOT NULL,
  `renewal_notification` INTEGER NOT NULL,
  `commercial_unit_id` BIGINT,
  `group_id` BIGINT,
  `document_url` TEXT NOT NULL,
  `computed_data` TEXT NOT NULL,
  `completed_at` TEXT,
  `origin_from_prospects` INTEGER NOT NULL);
--> statement-breakpoint
INSERT INTO `customer_clientagency__stg` SELECT * FROM `customer_clientagency`;
--> statement-breakpoint
DROP TABLE `customer_clientagency`;
--> statement-breakpoint
CREATE TABLE `customer_clientagency` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `agency_id` BIGINT NOT NULL,
  `client_id` BIGINT NOT NULL,
  `created_by` TEXT NOT NULL,
  `created_by_slug` TEXT NOT NULL,
  `birthday_notification` INTEGER NOT NULL,
  `payment_notification` INTEGER NOT NULL,
  `renewal_notification` INTEGER NOT NULL,
  `commercial_unit_id` BIGINT,
  `group_id` BIGINT,
  `document_url` TEXT NOT NULL,
  `computed_data` TEXT NOT NULL,
  `completed_at` TEXT,
  `origin_from_prospects` INTEGER NOT NULL,
  CONSTRAINT `customer_clientagency_agency_id_2219f9d3_fk_business_agency_id` FOREIGN KEY (`agency_id`) REFERENCES `agencies` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED);
--> statement-breakpoint
INSERT INTO `customer_clientagency` SELECT * FROM `customer_clientagency__stg`;
--> statement-breakpoint
DROP TABLE `customer_clientagency__stg`;
--> statement-breakpoint
CREATE INDEX `customer_clientagency_agency_id_2219f9d3` ON `customer_clientagency` (`agency_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `customer_clientagency_client_id_agency_id_8d00008e_uniq` ON `customer_clientagency` (`client_id`, `agency_id`);
--> statement-breakpoint
CREATE INDEX `customer_clientagency_client_id_f7514a49` ON `customer_clientagency` (`client_id`);
--> statement-breakpoint
CREATE INDEX `customer_clientagency_commercial_unit_id_c62e178e` ON `customer_clientagency` (`commercial_unit_id`);
--> statement-breakpoint
CREATE INDEX `customer_clientagency_created_by_slug_fc0af2df` ON `customer_clientagency` (`created_by_slug`);
--> statement-breakpoint
CREATE INDEX `customer_clientagency_created_by_slug_fc0af2df_like` ON `customer_clientagency` (`created_by_slug`);
--> statement-breakpoint
CREATE INDEX `customer_clientagency_group_id_45d26c9d` ON `customer_clientagency` (`group_id`);
--> statement-breakpoint
CREATE INDEX `customer_clientagency_id_slug_44ceaef1_like` ON `customer_clientagency` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `customer_clientagency_id_slug_key` ON `customer_clientagency` (`id_slug`);
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
DROP TABLE IF EXISTS `app_economicactivity`;
--> statement-breakpoint
DROP TABLE IF EXISTS `business_commercialunit`;
--> statement-breakpoint
DROP TABLE IF EXISTS `customer_client`;
--> statement-breakpoint
DROP TABLE IF EXISTS `customer_group`;
