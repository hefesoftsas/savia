CREATE TABLE IF NOT EXISTS crm_file_revisions (
 tenant_id TEXT NOT NULL,
 file_id TEXT NOT NULL REFERENCES crm_files(id) ON DELETE CASCADE,
 version INTEGER NOT NULL CHECK(version > 0),
 storage_key TEXT NOT NULL UNIQUE,
 size INTEGER NOT NULL CHECK(size > 0),
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 created_by TEXT,
 PRIMARY KEY(tenant_id,file_id,version)
);
