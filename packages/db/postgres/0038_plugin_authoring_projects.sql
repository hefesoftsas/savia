CREATE TABLE savia_core.plugin_authoring_projects (
  tenant_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  id TEXT NOT NULL,
  label TEXT NOT NULL,
  files TEXT NOT NULL,
  history TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  updated_at TEXT NOT NULL DEFAULT to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  PRIMARY KEY (tenant_id, principal_id, id)
);
CREATE INDEX idx_plugin_authoring_projects_scope_updated
  ON savia_core.plugin_authoring_projects (tenant_id, principal_id, updated_at DESC);
CREATE TABLE savia_core.plugin_store_sources (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  version TEXT NOT NULL,
  files TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  PRIMARY KEY (tenant_id, id, version),
  FOREIGN KEY (tenant_id, id, version)
    REFERENCES savia_core.plugin_store_artifacts (tenant_id, id, version) ON DELETE CASCADE
);
