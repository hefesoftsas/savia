CREATE TABLE IF NOT EXISTS crm_business_links (
 tenant_id TEXT NOT NULL, object_name TEXT NOT NULL, record_id TEXT NOT NULL,
 connection_id TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('syncing','synced','uncertain')),
 external_object_id TEXT, last_synced_at TEXT,
 PRIMARY KEY(tenant_id,object_name,record_id,connection_id),
 FOREIGN KEY(tenant_id,record_id) REFERENCES crm_records(tenant_id,id)
);
