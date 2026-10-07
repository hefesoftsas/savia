-- Blocking human approvals suspend an execution until the assignee decides
-- or the due date passes. Additive table: existing history is untouched.
CREATE TABLE savia_core.workflow_approvals (
    workspace_id text NOT NULL,
    id text NOT NULL,
    execution_id text NOT NULL,
    node_id text NOT NULL,
    title text NOT NULL,
    assignee text NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    decision text,
    comment text,
    decided_by text,
    decided_at bigint,
    due_at bigint NOT NULL,
    iteration bigint NOT NULL DEFAULT 0,
    created_at text DEFAULT to_char((CURRENT_TIMESTAMP AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD HH24:MI:SS'::text) NOT NULL,
    CONSTRAINT workflow_approvals_status_check CHECK ((status = ANY (ARRAY['open'::text, 'decided'::text, 'expired'::text]))),
    CONSTRAINT workflow_approvals_decision_check CHECK ((decision = ANY (ARRAY['approved'::text, 'rejected'::text])))
);
ALTER TABLE ONLY savia_core.workflow_approvals
    ADD CONSTRAINT workflow_approvals_pkey PRIMARY KEY (workspace_id, id);
ALTER TABLE ONLY savia_core.workflow_approvals
    ADD CONSTRAINT workflow_approvals_workspace_id_execution_id_node_id_iteration_key UNIQUE (workspace_id, execution_id, node_id, iteration);
CREATE INDEX idx_workflow_approvals_assignee ON savia_core.workflow_approvals (workspace_id, assignee, created_at DESC);
