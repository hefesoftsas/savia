CREATE TABLE plugin_store_artifacts (
 tenant_id TEXT NOT NULL, id TEXT NOT NULL, version TEXT NOT NULL,
 manifest TEXT NOT NULL CHECK(savia_json_valid(manifest)),
 entry_js TEXT NOT NULL,
 store_json TEXT CHECK(store_json IS NULL OR savia_json_valid(store_json)),
 sha256 TEXT NOT NULL,
 size_bytes BIGINT NOT NULL CHECK(size_bytes > 0),
 created_by TEXT,
 created_at TEXT NOT NULL DEFAULT (to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
 updated_at TEXT NOT NULL DEFAULT (to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
 PRIMARY KEY(tenant_id,id,version)
);
CREATE INDEX idx_plugin_store_artifacts_tenant ON plugin_store_artifacts(tenant_id,id);
