CREATE TABLE crm_sync_rules (
 id TEXT PRIMARY KEY,
 principal_id TEXT NOT NULL REFERENCES identity_principal(id),
 agency_id INTEGER NOT NULL REFERENCES agencies(id),
 provider TEXT NOT NULL CHECK(provider IN ('hubspot','salesforce','zoho','pipedrive')),
 connection_id TEXT NOT NULL REFERENCES agency_crm_connections(id),
 external_account_id TEXT NOT NULL,
 account_label TEXT NOT NULL,
 enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 UNIQUE(principal_id,agency_id,provider,connection_id,external_account_id)
);
--> statement-breakpoint
CREATE TABLE crm_sync_jobs (
 id TEXT PRIMARY KEY,
 rule_id TEXT NOT NULL REFERENCES crm_sync_rules(id),
 customer_id INTEGER NOT NULL,
 revision INTEGER NOT NULL DEFAULT 1,
 synced_revision INTEGER NOT NULL DEFAULT 0,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','synced','failed','blocked')),
 attempts INTEGER NOT NULL DEFAULT 0,
 next_attempt_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 lease_token TEXT,
 lease_started_at TEXT,
 last_error TEXT,
 external_url TEXT,
 updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 UNIQUE(rule_id,customer_id)
);
--> statement-breakpoint
CREATE INDEX crm_sync_jobs_due ON crm_sync_jobs(status,next_attempt_at);
--> statement-breakpoint
CREATE TABLE crm_sync_mappings (
 rule_id TEXT NOT NULL REFERENCES crm_sync_rules(id),
 customer_id INTEGER NOT NULL,
 object_kind TEXT NOT NULL CHECK(object_kind IN ('contact','company')),
 external_object_id TEXT NOT NULL,
 updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 PRIMARY KEY(rule_id,customer_id,object_kind)
);
--> statement-breakpoint
CREATE TRIGGER crm_sync_customer_naturalperson_insert AFTER INSERT ON customer_naturalperson
BEGIN
 INSERT INTO crm_sync_jobs(id,rule_id,customer_id)
 SELECT r.id || ':' || p.id,r.id,p.id FROM crm_sync_rules r JOIN customer_clientagency p ON p.agency_id=r.agency_id
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
 SELECT r.id || ':' || p.id,r.id,p.id FROM crm_sync_rules r JOIN customer_clientagency p ON p.agency_id=r.agency_id
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
 SELECT r.id || ':' || p.id,r.id,p.id FROM crm_sync_rules r JOIN customer_clientagency p ON p.agency_id=r.agency_id
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
 SELECT r.id || ':' || p.id,r.id,p.id FROM crm_sync_rules r JOIN customer_clientagency p ON p.agency_id=r.agency_id
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
 SELECT r.id || ':' || p.id,r.id,p.id FROM crm_sync_rules r JOIN customer_clientagency p ON p.agency_id=r.agency_id
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
 SELECT r.id || ':' || p.id,r.id,p.id FROM crm_sync_rules r JOIN customer_clientagency p ON p.agency_id=r.agency_id
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
 SELECT r.id || ':' || p.id,r.id,p.id FROM crm_sync_rules r JOIN customer_clientagency p ON p.agency_id=r.agency_id
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
 SELECT r.id || ':' || p.id,r.id,p.id FROM crm_sync_rules r JOIN customer_clientagency p ON p.agency_id=r.agency_id
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
 SELECT r.id || ':' || p.id,r.id,p.id FROM crm_sync_rules r JOIN customer_clientagency p ON p.agency_id=r.agency_id
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
 SELECT r.id || ':' || p.id,r.id,p.id FROM crm_sync_rules r JOIN customer_clientagency p ON p.agency_id=r.agency_id
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
 SELECT r.id || ':' || p.id,r.id,p.id FROM crm_sync_rules r JOIN customer_clientagency p ON p.agency_id=r.agency_id
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
 SELECT r.id || ':' || p.id,r.id,p.id FROM crm_sync_rules r JOIN customer_clientagency p ON p.agency_id=r.agency_id
 WHERE r.enabled=1 AND p.id IN (SELECT client_id FROM customer_legalperson WHERE id=OLD.legal_person_id)
 ON CONFLICT(rule_id,customer_id) DO UPDATE SET revision=revision+1,
 status=CASE WHEN status='processing' OR (status='blocked' AND COALESCE(last_error,'')<>'RULE_PAUSED') THEN status ELSE 'pending' END,
 attempts=CASE WHEN status='processing' OR (status='blocked' AND COALESCE(last_error,'')<>'RULE_PAUSED') THEN attempts ELSE 0 END,
 last_error=CASE WHEN status='processing' OR (status='blocked' AND COALESCE(last_error,'')<>'RULE_PAUSED') THEN last_error ELSE NULL END,
 next_attempt_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now');
END;
