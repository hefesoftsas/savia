-- Add the shared Savia Request bundle ledger to the native core schema.
CREATE TABLE IF NOT EXISTS installed_bundles (
  id TEXT PRIMARY KEY,
  version TEXT NOT NULL,
  installed_at TEXT NOT NULL
);
