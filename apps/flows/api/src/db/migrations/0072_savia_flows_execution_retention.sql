CREATE INDEX IF NOT EXISTS savia_local_executions_retention_idx
  ON savia_local_executions (status, updated_at, organization_id, id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS savia_flows_execution_retention (
  id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
  claimed_day TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0,
  lease_token TEXT,
  last_completed_day TEXT
);
