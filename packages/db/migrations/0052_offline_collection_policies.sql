-- Per-tenant offline-first policy for CRM collections. Managed from the
-- admin ("Offline" screen); read by clients to decide what persists and how
-- often lists refetch. Absence of a row means offline disabled.
CREATE TABLE IF NOT EXISTS offline_collection_policies (
  tenant_id INTEGER NOT NULL,
  collection TEXT NOT NULL,
  is_enabled INTEGER NOT NULL DEFAULT 1,
  refresh_seconds INTEGER NOT NULL DEFAULT 300,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, collection)
);
