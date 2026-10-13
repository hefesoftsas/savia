CREATE TABLE savia_http_execution_authorities (
  workflow_id TEXT PRIMARY KEY NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX savia_http_execution_authorities_org_active_idx
  ON savia_http_execution_authorities (organization_id, active);
