ALTER TABLE plugin_authoring_projects
  ADD COLUMN installed_editor_extensions TEXT NOT NULL DEFAULT '[]'
  CHECK (json_valid(installed_editor_extensions));
--> statement-breakpoint
CREATE TABLE plugin_editor_extension_inspections (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('open-vsx','vsix')),
  metadata_json TEXT NOT NULL CHECK (json_valid(metadata_json)),
  manifest_json TEXT NOT NULL CHECK (json_valid(manifest_json)),
  object_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  reservation_bytes INTEGER NOT NULL DEFAULT 0 CHECK (reservation_bytes >= 0)
);
--> statement-breakpoint
CREATE INDEX plugin_editor_extension_inspections_scope_expiry
  ON plugin_editor_extension_inspections(tenant_id,principal_id,expires_at);
--> statement-breakpoint
CREATE TABLE plugin_editor_extension_artifacts (
  tenant_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  object_key TEXT NOT NULL,
  compressed_bytes INTEGER NOT NULL CHECK (compressed_bytes > 0),
  expanded_bytes INTEGER NOT NULL CHECK (expanded_bytes > 0),
  created_at TEXT NOT NULL,
  reference_count INTEGER NOT NULL DEFAULT 0 CHECK (reference_count >= 0),
  PRIMARY KEY (tenant_id,principal_id,sha256),
  UNIQUE (object_key)
);
--> statement-breakpoint
CREATE TABLE plugin_editor_extension_installations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  publisher TEXT NOT NULL,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  metadata_json TEXT NOT NULL CHECK (json_valid(metadata_json)),
  source TEXT NOT NULL CHECK (source IN ('open-vsx','vsix')),
  object_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (tenant_id,principal_id,publisher,name,version),
  FOREIGN KEY (tenant_id,principal_id,sha256)
    REFERENCES plugin_editor_extension_artifacts(tenant_id,principal_id,sha256)
    ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX plugin_editor_extension_installations_scope
  ON plugin_editor_extension_installations(tenant_id,principal_id,publisher,name,version);
--> statement-breakpoint
CREATE TABLE plugin_editor_extension_cleanup (
  object_key TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);
--> statement-breakpoint
