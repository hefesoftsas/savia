-- Savia Request per-tenant overlays and bundle provenance for the shared
-- production database. Mirrors apps/savia-request/migrations/0004 and 0005.
CREATE TABLE tenant_flows (tenant_id TEXT NOT NULL, flow_id TEXT NOT NULL, definition TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(tenant_id, flow_id));
CREATE TABLE tenant_flow_variables (tenant_id TEXT NOT NULL, flow_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, secret BIGINT NOT NULL DEFAULT 0, updated_at TEXT NOT NULL, PRIMARY KEY(tenant_id, flow_id, key));
CREATE TABLE tenant_flow_versions (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, flow_id TEXT NOT NULL, definition TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX tenant_flow_versions_scope_idx ON tenant_flow_versions(tenant_id, flow_id, created_at);
CREATE TABLE tenant_flow_runs (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, flow_id TEXT NOT NULL, version_id TEXT, mode TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, summary TEXT NOT NULL);
CREATE INDEX tenant_flow_runs_scope_idx ON tenant_flow_runs(tenant_id, flow_id, created_at);
CREATE TABLE tenant_folders (tenant_id TEXT NOT NULL, path TEXT NOT NULL, PRIMARY KEY(tenant_id, path));
CREATE TABLE tenant_bundles (tenant_id TEXT NOT NULL, id TEXT NOT NULL, version TEXT NOT NULL, installed_at TEXT NOT NULL, PRIMARY KEY(tenant_id, id));
CREATE TABLE bundle_flow_state (scope TEXT NOT NULL, flow_id TEXT NOT NULL, bundle_version TEXT NOT NULL, content_hash TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(scope, flow_id));
