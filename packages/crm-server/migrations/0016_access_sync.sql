ALTER TABLE crm_records ADD COLUMN created_by TEXT;

ALTER TABLE crm_sync_changes ADD COLUMN created_by TEXT;

DROP TRIGGER crm_sync_insert;

CREATE TRIGGER crm_sync_insert AFTER INSERT ON crm_records BEGIN
 INSERT INTO crm_sync_changes(tenant_id,object_name,id,data,version,created_at,updated_at,deleted_at,created_by) VALUES (NEW.tenant_id,NEW.object_name,NEW.id,NEW.data,NEW.version,NEW.created_at,NEW.updated_at,NEW.deleted_at,NEW.created_by) ON CONFLICT(tenant_id,object_name,id) DO UPDATE SET sequence=excluded.sequence,data=excluded.data,version=excluded.version,created_at=excluded.created_at,updated_at=excluded.updated_at,deleted_at=excluded.deleted_at,created_by=excluded.created_by;
END;

DROP TRIGGER crm_sync_update;

CREATE TRIGGER crm_sync_update AFTER UPDATE ON crm_records BEGIN
 INSERT INTO crm_sync_changes(tenant_id,object_name,id,data,version,created_at,updated_at,deleted_at,created_by) VALUES (NEW.tenant_id,NEW.object_name,NEW.id,NEW.data,NEW.version,NEW.created_at,NEW.updated_at,NEW.deleted_at,NEW.created_by) ON CONFLICT(tenant_id,object_name,id) DO UPDATE SET sequence=excluded.sequence,data=excluded.data,version=excluded.version,created_at=excluded.created_at,updated_at=excluded.updated_at,deleted_at=excluded.deleted_at,created_by=excluded.created_by;
END;

DROP TRIGGER crm_sync_delete;

CREATE TRIGGER crm_sync_delete AFTER DELETE ON crm_records BEGIN
 INSERT INTO crm_sync_changes(tenant_id,object_name,id,data,version,created_at,updated_at,deleted_at,created_by) VALUES (OLD.tenant_id,OLD.object_name,OLD.id,OLD.data,OLD.version+1,OLD.created_at,OLD.updated_at,COALESCE(OLD.deleted_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')),OLD.created_by) ON CONFLICT(tenant_id,object_name,id) DO UPDATE SET sequence=excluded.sequence,data=excluded.data,version=excluded.version,created_at=excluded.created_at,updated_at=excluded.updated_at,deleted_at=excluded.deleted_at,created_by=excluded.created_by;
END;

CREATE TABLE crm_access_deliveries (principal_id TEXT NOT NULL,scope TEXT NOT NULL,revision INTEGER NOT NULL,object_name TEXT NOT NULL,record_id TEXT NOT NULL,PRIMARY KEY(principal_id,scope,revision,object_name,record_id));
