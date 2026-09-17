CREATE TABLE extension_settings (
  tenant_id TEXT NOT NULL,
  extension_id TEXT NOT NULL,
  value TEXT NOT NULL CHECK (json_valid(value)),
  version INTEGER NOT NULL,
  created_by_principal_id TEXT NOT NULL,
  updated_by_principal_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, extension_id)
);
CREATE INDEX extension_settings_tenant_updated_index
  ON extension_settings (tenant_id, updated_at DESC);
