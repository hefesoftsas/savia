CREATE TABLE IF NOT EXISTS savia_flows_execution_policy (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  workflow_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('active', 'completed')),
  active INTEGER NOT NULL CHECK (active IN (0, 1)),
  steps INTEGER NOT NULL DEFAULT 0,
  max_steps INTEGER NOT NULL,
  lease_until INTEGER NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS savia_flows_execution_policy_window_idx
  ON savia_flows_execution_policy (created_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS savia_flows_execution_policy_active_idx
  ON savia_flows_execution_policy (active, state);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS savia_flows_execution_control (
  id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
  paused INTEGER NOT NULL CHECK (paused IN (0, 1)),
  updated_at INTEGER NOT NULL,
  generation INTEGER NOT NULL DEFAULT 0
);
