ALTER TABLE crm_integrations ADD COLUMN connection TEXT NOT NULL DEFAULT '{}';
ALTER TABLE crm_integrations ADD COLUMN encrypted_secret TEXT;
CREATE TABLE crm_integration_runs (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, integration_id TEXT NOT NULL, operation_id TEXT NOT NULL,
 method TEXT NOT NULL, status TEXT NOT NULL, http_status INTEGER, attempts INTEGER NOT NULL DEFAULT 0,
 duration_ms INTEGER NOT NULL DEFAULT 0, error TEXT, response TEXT, idempotency_key TEXT, request_hash TEXT,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX crm_integration_runs_history ON crm_integration_runs(tenant_id,integration_id,created_at);
CREATE UNIQUE INDEX crm_integration_runs_idempotency ON crm_integration_runs(tenant_id,integration_id,operation_id,idempotency_key) WHERE idempotency_key IS NOT NULL;
