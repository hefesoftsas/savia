CREATE TABLE IF NOT EXISTS tenant_flows (tenant_id TEXT NOT NULL, flow_id TEXT NOT NULL, definition TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(tenant_id, flow_id));
CREATE TABLE IF NOT EXISTS tenant_flow_variables (tenant_id TEXT NOT NULL, flow_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, secret INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL, PRIMARY KEY(tenant_id, flow_id, key));
CREATE TABLE IF NOT EXISTS tenant_flow_versions (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, flow_id TEXT NOT NULL, definition TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS tenant_flow_versions_scope_idx ON tenant_flow_versions(tenant_id, flow_id, created_at);
CREATE TABLE IF NOT EXISTS tenant_flow_runs (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, flow_id TEXT NOT NULL, version_id TEXT, mode TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, summary TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS tenant_flow_runs_scope_idx ON tenant_flow_runs(tenant_id, flow_id, created_at);
CREATE TABLE IF NOT EXISTS tenant_folders (tenant_id TEXT NOT NULL, path TEXT NOT NULL, PRIMARY KEY(tenant_id, path));
CREATE TABLE IF NOT EXISTS tenant_bundles (tenant_id TEXT NOT NULL, id TEXT NOT NULL, version TEXT NOT NULL, installed_at TEXT NOT NULL, PRIMARY KEY(tenant_id, id));
