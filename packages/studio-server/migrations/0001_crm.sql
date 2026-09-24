CREATE TABLE IF NOT EXISTS crm_objects (
 tenant_id TEXT NOT NULL, name TEXT NOT NULL, label TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
 config TEXT NOT NULL CHECK(json_valid(config)), created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 PRIMARY KEY (tenant_id, name)
);
CREATE TABLE IF NOT EXISTS crm_records (
 id TEXT NOT NULL, tenant_id TEXT NOT NULL, object_name TEXT NOT NULL, data TEXT NOT NULL CHECK(json_valid(data)),
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 PRIMARY KEY (tenant_id, id), FOREIGN KEY (tenant_id, object_name) REFERENCES crm_objects(tenant_id, name)
);
CREATE INDEX IF NOT EXISTS crm_records_object ON crm_records(tenant_id, object_name, updated_at);
CREATE TABLE IF NOT EXISTS crm_views (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, object_name TEXT NOT NULL, name TEXT NOT NULL, config TEXT NOT NULL CHECK(json_valid(config))
);
CREATE TABLE IF NOT EXISTS crm_integrations (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT NOT NULL, document TEXT NOT NULL CHECK(json_valid(document)), created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS crm_audit (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, action TEXT NOT NULL, object_name TEXT NOT NULL, record_id TEXT, detail TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
