-- Blocking human approvals suspend an execution until the assignee decides
-- or the due date passes. Additive table: existing history is untouched.
CREATE TABLE workflow_approvals (
  workspace_id TEXT NOT NULL, id TEXT NOT NULL,
  execution_id TEXT NOT NULL, node_id TEXT NOT NULL,
  title TEXT NOT NULL, assignee TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','decided','expired')),
  decision TEXT CHECK(decision IN ('approved','rejected')),
  comment TEXT, decided_by TEXT, decided_at INTEGER,
  due_at INTEGER NOT NULL, iteration INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(workspace_id,id), UNIQUE(workspace_id,execution_id,node_id,iteration),
  FOREIGN KEY(workspace_id,execution_id) REFERENCES workflow_executions(workspace_id,id)
);
--> statement-breakpoint
CREATE INDEX idx_workflow_approvals_assignee ON workflow_approvals(workspace_id,assignee,created_at DESC);
