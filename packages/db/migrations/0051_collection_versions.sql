-- Monotonic per-collection version for delta sync. Bumped by the
-- dynamic-crm proxy on every record/view mutation so subscribers can skip
-- refetches they already covered. Never blocks a mutation if missing.
CREATE TABLE IF NOT EXISTS crm_collection_versions (
  tenant_id TEXT NOT NULL,
  collection TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, collection)
);
