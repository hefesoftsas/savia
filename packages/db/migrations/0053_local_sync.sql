CREATE TABLE crm_sync_changes (
 sequence INTEGER PRIMARY KEY AUTOINCREMENT,
 tenant_id TEXT NOT NULL, object_name TEXT NOT NULL,
 id TEXT NOT NULL, data TEXT NOT NULL, version INTEGER NOT NULL,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT,
 UNIQUE(tenant_id,object_name,id)
);
--> statement-breakpoint

CREATE INDEX crm_sync_changes_scope ON crm_sync_changes(tenant_id,object_name,sequence);
--> statement-breakpoint

CREATE TABLE crm_sync_receipts (
 tenant_id TEXT NOT NULL, principal_id TEXT NOT NULL, mutation_id TEXT NOT NULL,
 fingerprint TEXT NOT NULL, response TEXT NOT NULL,
 before_state TEXT, effects_applied INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(tenant_id,principal_id,mutation_id)
);
--> statement-breakpoint

CREATE TRIGGER crm_sync_insert AFTER INSERT ON crm_records BEGIN
 INSERT INTO crm_sync_changes(tenant_id,object_name,id,data,version,created_at,updated_at,deleted_at)
 VALUES (NEW.tenant_id,NEW.object_name,NEW.id,NEW.data,NEW.version,NEW.created_at,NEW.updated_at,NEW.deleted_at)
 ON CONFLICT(tenant_id,object_name,id) DO UPDATE SET sequence=excluded.sequence,data=excluded.data,version=excluded.version,created_at=excluded.created_at,updated_at=excluded.updated_at,deleted_at=excluded.deleted_at;
END;
--> statement-breakpoint

CREATE TRIGGER crm_sync_update AFTER UPDATE ON crm_records BEGIN
 INSERT INTO crm_sync_changes(tenant_id,object_name,id,data,version,created_at,updated_at,deleted_at)
 VALUES (NEW.tenant_id,NEW.object_name,NEW.id,NEW.data,NEW.version,NEW.created_at,NEW.updated_at,NEW.deleted_at)
 ON CONFLICT(tenant_id,object_name,id) DO UPDATE SET sequence=excluded.sequence,data=excluded.data,version=excluded.version,created_at=excluded.created_at,updated_at=excluded.updated_at,deleted_at=excluded.deleted_at;
END;
--> statement-breakpoint

CREATE TRIGGER crm_sync_delete AFTER DELETE ON crm_records BEGIN
 INSERT INTO crm_sync_changes(tenant_id,object_name,id,data,version,created_at,updated_at,deleted_at)
 VALUES (OLD.tenant_id,OLD.object_name,OLD.id,OLD.data,OLD.version+1,OLD.created_at,OLD.updated_at,COALESCE(OLD.deleted_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')))
 ON CONFLICT(tenant_id,object_name,id) DO UPDATE SET sequence=excluded.sequence,data=excluded.data,version=excluded.version,created_at=excluded.created_at,updated_at=excluded.updated_at,deleted_at=excluded.deleted_at;
END;
--> statement-breakpoint

-- Triggers precede the seed so writes during deployment cannot fall in a gap.
INSERT INTO crm_sync_changes(tenant_id,object_name,id,data,version,created_at,updated_at,deleted_at)
 SELECT r.tenant_id,r.object_name,r.id,r.data,r.version,r.created_at,r.updated_at,r.deleted_at FROM crm_records r
 WHERE NOT EXISTS (SELECT 1 FROM crm_sync_changes c WHERE c.tenant_id=r.tenant_id AND c.object_name=r.object_name AND c.id=r.id);
--> statement-breakpoint
