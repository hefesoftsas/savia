CREATE TABLE durable_object_registry (
  kind TEXT NOT NULL CHECK (kind IN ('workflow-agent', 'agent-runner', 'email-agent-runner')),
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (kind, name)
);
