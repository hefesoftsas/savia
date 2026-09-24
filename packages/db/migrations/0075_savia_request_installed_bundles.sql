-- Savia Request shares the domain D1 database in preview and production.
-- Keep its global bundle ledger alongside the tenant-scoped tables.
CREATE TABLE IF NOT EXISTS installed_bundles (
  id TEXT PRIMARY KEY,
  version TEXT NOT NULL,
  installed_at TEXT NOT NULL
);
