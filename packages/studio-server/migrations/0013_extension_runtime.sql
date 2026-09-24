CREATE TABLE extension_connections (
  tenant_id TEXT NOT NULL,
  extension_id TEXT NOT NULL,
  id TEXT NOT NULL,
  connector_id TEXT NOT NULL,
  credential_ciphertext TEXT NOT NULL,
  credential_iv TEXT NOT NULL,
  created_by_principal_id TEXT NOT NULL,
  updated_by_principal_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, extension_id, id)
);
CREATE INDEX extension_connections_tenant_updated_index
  ON extension_connections (tenant_id, updated_at DESC);
CREATE TABLE extension_connection_audit_events (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  extension_id TEXT NOT NULL,
  connection_id TEXT NOT NULL,
  actor_principal_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('success', 'failure')),
  error_code TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX extension_connection_audit_events_tenant_created_index
  ON extension_connection_audit_events (tenant_id, created_at DESC);
CREATE TABLE extension_action_runs (
  tenant_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  extension_id TEXT NOT NULL,
  action_id TEXT NOT NULL,
  connection_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'succeeded', 'failed', 'expired')),
  input TEXT NOT NULL CHECK (json_valid(input)),
  output TEXT,
  error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, run_id)
);
CREATE INDEX extension_action_runs_tenant_updated_index
  ON extension_action_runs (tenant_id, updated_at DESC);
