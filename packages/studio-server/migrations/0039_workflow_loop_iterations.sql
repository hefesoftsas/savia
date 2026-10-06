-- Loop iterations need one history row per step invocation. The previous
-- PRIMARY KEY(workspace_id,execution_id,node_id) allowed a single row per
-- step; repeated loop passes get a per-execution invocation counter instead.
-- Forward-only rebuild: existing rows keep their relative order.
CREATE TABLE workflow_jobs_new (
  workspace_id TEXT NOT NULL, execution_id TEXT NOT NULL, node_id TEXT NOT NULL,
  sequence INTEGER NOT NULL, type TEXT NOT NULL, input TEXT NOT NULL, output TEXT NOT NULL,
  attempts INTEGER NOT NULL, invocation INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(workspace_id,execution_id,invocation),
  FOREIGN KEY(workspace_id,execution_id) REFERENCES workflow_executions(workspace_id,id)
);
--> statement-breakpoint
INSERT INTO workflow_jobs_new(workspace_id,execution_id,node_id,sequence,type,input,output,attempts,created_at,invocation)
  SELECT workspace_id,execution_id,node_id,sequence,type,input,output,attempts,created_at,
    ROW_NUMBER() OVER (PARTITION BY workspace_id,execution_id ORDER BY sequence,node_id,rowid)
  FROM workflow_jobs;
--> statement-breakpoint
DROP TABLE workflow_jobs;
--> statement-breakpoint
ALTER TABLE workflow_jobs_new RENAME TO workflow_jobs;
--> statement-breakpoint
-- A task step inside a loop body assigns one inbox item per pass. Keep the
-- single-pass uniqueness and scope repeats by iteration instead.
CREATE TABLE workflow_tasks_new (
  workspace_id TEXT NOT NULL, id TEXT NOT NULL, execution_id TEXT NOT NULL, node_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('task','notification')), title TEXT NOT NULL, assignee TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','done')), due_at INTEGER,
  iteration INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(workspace_id,id), UNIQUE(workspace_id,execution_id,node_id,iteration),
  FOREIGN KEY(workspace_id,execution_id) REFERENCES workflow_executions(workspace_id,id)
);
--> statement-breakpoint
INSERT INTO workflow_tasks_new(workspace_id,id,execution_id,node_id,kind,title,assignee,status,due_at,iteration,created_at)
  SELECT workspace_id,id,execution_id,node_id,kind,title,assignee,status,due_at,0,created_at FROM workflow_tasks;
--> statement-breakpoint
DROP TABLE workflow_tasks;
--> statement-breakpoint
ALTER TABLE workflow_tasks_new RENAME TO workflow_tasks;
