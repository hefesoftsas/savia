CREATE TABLE tenant_pages_search_settings (
  tenant_id BIGINT PRIMARY KEY NOT NULL
    REFERENCES tenants(id) ON DELETE CASCADE,
  allowed BIGINT NOT NULL DEFAULT 0 CHECK (allowed IN (0, 1)),
  enabled BIGINT NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  updated_at TEXT NOT NULL,
  CHECK (enabled <= allowed)
);
