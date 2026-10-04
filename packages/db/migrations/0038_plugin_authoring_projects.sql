CREATE TABLE plugin_authoring_projects (
  tenant_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  id TEXT NOT NULL,
  label TEXT NOT NULL,
  files TEXT NOT NULL,
  history TEXT NOT NULL,
  version INTEGER NOT NULL CHECK(version > 0),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (tenant_id, principal_id, id)
);
--> statement-breakpoint
CREATE INDEX idx_plugin_authoring_projects_scope_updated
  ON plugin_authoring_projects(tenant_id, principal_id, updated_at DESC);
--> statement-breakpoint
CREATE TABLE plugin_store_sources (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  version TEXT NOT NULL,
  files TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (tenant_id, id, version),
  FOREIGN KEY (tenant_id, id, version)
    REFERENCES plugin_store_artifacts(tenant_id, id, version) ON DELETE CASCADE
);
