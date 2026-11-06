CREATE TABLE IF NOT EXISTS savia_scheduled_trigger_occurrences (
  workflow_id TEXT NOT NULL,
  scheduled_time INTEGER NOT NULL,
  execution_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (
    status IN ('claimed', 'dispatched', 'completed', 'uncertain', 'obsolete')
  ),
  runtime TEXT CHECK (runtime IN ('worker', 'workflow')),
  schedule_expression TEXT NOT NULL,
  trigger_updated_at INTEGER NOT NULL,
  workflow_updated_at INTEGER NOT NULL,
  workflow_fingerprint TEXT NOT NULL,
  lease_token TEXT NOT NULL,
  lease_until INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (workflow_id, scheduled_time)
);

CREATE INDEX IF NOT EXISTS savia_scheduled_trigger_occurrences_lease_idx
  ON savia_scheduled_trigger_occurrences (status, lease_until);
