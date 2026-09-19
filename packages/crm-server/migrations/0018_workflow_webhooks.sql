CREATE TABLE workflow_webhook_endpoints (
 workspace_id TEXT NOT NULL, id TEXT NOT NULL UNIQUE, workflow_id TEXT NOT NULL, secret_hash TEXT NOT NULL,
 PRIMARY KEY(workspace_id,id), UNIQUE(workspace_id,workflow_id),
 FOREIGN KEY(workspace_id,workflow_id) REFERENCES workflows(workspace_id,id)
);
CREATE TABLE workflow_webhook_receipts (
 workspace_id TEXT NOT NULL, endpoint_id TEXT NOT NULL, event_key TEXT NOT NULL, payload_hash TEXT NOT NULL, execution_id TEXT NOT NULL,
 PRIMARY KEY(workspace_id,endpoint_id,event_key),
 FOREIGN KEY(workspace_id,endpoint_id) REFERENCES workflow_webhook_endpoints(workspace_id,id),
 FOREIGN KEY(workspace_id,execution_id) REFERENCES workflow_executions(workspace_id,id)
);
CREATE TABLE workflow_webhook_admissions (
 endpoint_id TEXT NOT NULL, minute INTEGER NOT NULL, count INTEGER NOT NULL CHECK(count BETWEEN 1 AND 60),
 PRIMARY KEY(endpoint_id,minute), FOREIGN KEY(endpoint_id) REFERENCES workflow_webhook_endpoints(id)
);
CREATE TABLE workflow_webhook_destinations (
 workspace_id TEXT NOT NULL, id TEXT NOT NULL, name TEXT NOT NULL, current_revision INTEGER NOT NULL,
 enabled INTEGER NOT NULL DEFAULT 1, encrypted_secret TEXT, credential_type TEXT NOT NULL, credential_header TEXT,
 PRIMARY KEY(workspace_id,id)
);
CREATE TABLE workflow_webhook_destination_versions (
 workspace_id TEXT NOT NULL, id TEXT NOT NULL, revision INTEGER NOT NULL, url TEXT NOT NULL, auth_type TEXT NOT NULL, auth_header TEXT,
 PRIMARY KEY(workspace_id,id,revision), FOREIGN KEY(workspace_id,id) REFERENCES workflow_webhook_destinations(workspace_id,id)
);
CREATE TABLE workflow_webhook_deliveries (
 workspace_id TEXT NOT NULL, execution_id TEXT NOT NULL, node_id TEXT NOT NULL,
 destination_id TEXT NOT NULL, destination_revision INTEGER NOT NULL, payload TEXT NOT NULL, stable_key TEXT NOT NULL,
 attempt_count INTEGER NOT NULL DEFAULT 0, retry_generation INTEGER NOT NULL DEFAULT 0, generation_attempts INTEGER NOT NULL DEFAULT 0,
 state TEXT NOT NULL DEFAULT 'prepared',
 PRIMARY KEY(workspace_id,execution_id,node_id),
 FOREIGN KEY(workspace_id,execution_id) REFERENCES workflow_executions(workspace_id,id),
 FOREIGN KEY(workspace_id,destination_id,destination_revision) REFERENCES workflow_webhook_destination_versions(workspace_id,id,revision)
);
CREATE TABLE workflow_webhook_attempts (
 workspace_id TEXT NOT NULL, execution_id TEXT NOT NULL, node_id TEXT NOT NULL, sequence INTEGER NOT NULL,
 lease_token TEXT NOT NULL, started_at INTEGER NOT NULL, finished_at INTEGER, status INTEGER, error TEXT, output TEXT,
 PRIMARY KEY(workspace_id,execution_id,node_id,sequence),
 FOREIGN KEY(workspace_id,execution_id,node_id) REFERENCES workflow_webhook_deliveries(workspace_id,execution_id,node_id)
);
