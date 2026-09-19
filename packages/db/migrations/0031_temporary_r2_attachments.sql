CREATE TABLE IF NOT EXISTS crm_file_drafts (
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL,
 object_name TEXT NOT NULL,
 field_name TEXT NOT NULL,
 name TEXT NOT NULL,
 mime TEXT NOT NULL,
 size INTEGER NOT NULL,
 storage_key TEXT NOT NULL UNIQUE,
 version INTEGER NOT NULL DEFAULT 1,
 expires_at TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
