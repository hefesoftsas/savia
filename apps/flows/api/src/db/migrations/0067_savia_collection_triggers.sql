CREATE TABLE savia_collection_triggers (
  workflow_id TEXT PRIMARY KEY NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  config TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX savia_collection_triggers_org_active_idx
  ON savia_collection_triggers (organization_id, active);
--> statement-breakpoint
CREATE TABLE savia_collection_admissions (
  event_id TEXT NOT NULL,
  workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  execution_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending',
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (event_id, workflow_id)
);
--> statement-breakpoint
CREATE INDEX savia_collection_admissions_pending_idx
  ON savia_collection_admissions (status, updated_at);
