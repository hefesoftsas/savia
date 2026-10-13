CREATE TABLE savia_local_executions (
  id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  workflow_id TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (organization_id, id)
);
--> statement-breakpoint
CREATE INDEX savia_local_executions_history
  ON savia_local_executions (organization_id, started_at DESC);
--> statement-breakpoint
CREATE INDEX savia_local_executions_workflow
  ON savia_local_executions (organization_id, workflow_id, started_at DESC);
