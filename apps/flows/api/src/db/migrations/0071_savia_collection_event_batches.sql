CREATE TABLE savia_collection_event_batch_groups (
  group_key TEXT PRIMARY KEY NOT NULL,
  bucket_key TEXT NOT NULL,
  workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL,
  config_created_at INTEGER NOT NULL,
  chunk_index INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  due_at INTEGER NOT NULL,
  next_attempt_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  lease_token TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  finished_at INTEGER,
  UNIQUE (bucket_key, chunk_index)
);
--> statement-breakpoint
CREATE INDEX savia_collection_event_batch_due_idx
  ON savia_collection_event_batch_groups (status, next_attempt_at, due_at);
--> statement-breakpoint
CREATE INDEX savia_collection_event_batch_org_status_idx
  ON savia_collection_event_batch_groups (organization_id, status, workflow_id);
--> statement-breakpoint
CREATE INDEX savia_collection_event_batch_retention_idx
  ON savia_collection_event_batch_groups (finished_at);
--> statement-breakpoint
CREATE TABLE savia_collection_event_batch_items (
  event_id TEXT NOT NULL,
  workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  execution_id TEXT,
  bucket_key TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  group_key TEXT NOT NULL REFERENCES savia_collection_event_batch_groups(group_key) ON DELETE CASCADE,
  event_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'skipped')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  finished_at INTEGER,
  PRIMARY KEY (event_id, workflow_id)
);
--> statement-breakpoint
CREATE INDEX savia_collection_event_batch_items_group_status_idx
  ON savia_collection_event_batch_items (group_key, status);
--> statement-breakpoint
CREATE INDEX savia_collection_event_batch_items_retention_idx
  ON savia_collection_event_batch_items (finished_at);
