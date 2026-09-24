CREATE TABLE plugin_store_artifacts (
 tenant_id TEXT NOT NULL, id TEXT NOT NULL, version TEXT NOT NULL,
 manifest TEXT NOT NULL CHECK(json_valid(manifest)),
 entry_js TEXT NOT NULL,
 sha256 TEXT NOT NULL,
 size_bytes INTEGER NOT NULL CHECK(size_bytes > 0),
 created_by TEXT,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 PRIMARY KEY(tenant_id,id,version)
);
CREATE INDEX idx_plugin_store_artifacts_tenant ON plugin_store_artifacts(tenant_id,id);
