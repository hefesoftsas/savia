-- Loop iterations need one history row per step invocation. The previous
-- PRIMARY KEY(workspace_id,execution_id,node_id) allowed a single row per
-- step; repeated loop passes get a per-execution invocation counter instead.
ALTER TABLE savia_core.workflow_jobs ADD COLUMN invocation bigint NOT NULL DEFAULT 0;
WITH ranked AS (
  SELECT ctid, ROW_NUMBER() OVER (PARTITION BY workspace_id, execution_id ORDER BY sequence, node_id, ctid) AS rn
  FROM savia_core.workflow_jobs
)
UPDATE savia_core.workflow_jobs AS job SET invocation = ranked.rn FROM ranked WHERE job.ctid = ranked.ctid;
ALTER TABLE savia_core.workflow_jobs ALTER COLUMN invocation DROP DEFAULT;
ALTER TABLE savia_core.workflow_jobs DROP CONSTRAINT workflow_jobs_pkey;
ALTER TABLE savia_core.workflow_jobs ADD CONSTRAINT workflow_jobs_pkey PRIMARY KEY (workspace_id, execution_id, invocation);
-- A task step inside a loop body assigns one inbox item per pass. Keep the
-- single-pass uniqueness and scope repeats by iteration instead.
ALTER TABLE savia_core.workflow_tasks ADD COLUMN iteration bigint NOT NULL DEFAULT 0;
ALTER TABLE savia_core.workflow_tasks DROP CONSTRAINT workflow_tasks_workspace_id_execution_id_node_id_key;
ALTER TABLE savia_core.workflow_tasks ADD CONSTRAINT workflow_tasks_workspace_id_execution_id_node_id_iteration_key UNIQUE (workspace_id, execution_id, node_id, iteration);
