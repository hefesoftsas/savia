CREATE TABLE bundle_flow_state (scope TEXT NOT NULL, flow_id TEXT NOT NULL, bundle_version TEXT NOT NULL, content_hash TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(scope, flow_id));
--> statement-breakpoint
CREATE TABLE flow_runs (id TEXT PRIMARY KEY, flow_id TEXT NOT NULL, version_id TEXT, mode TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, summary TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE flow_variables (flow_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, secret INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(flow_id,key));
--> statement-breakpoint
CREATE TABLE flow_versions (id TEXT PRIMARY KEY, flow_id TEXT NOT NULL, definition TEXT NOT NULL, created_at TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE flows (id TEXT PRIMARY KEY, definition TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE folders (path TEXT PRIMARY KEY);
--> statement-breakpoint
CREATE TABLE installed_bundles (id TEXT PRIMARY KEY, version TEXT NOT NULL, installed_at TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE savia_request_audit (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, flow_id TEXT, detail TEXT, created_at TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE tenant_bundles (tenant_id TEXT NOT NULL, id TEXT NOT NULL, version TEXT NOT NULL, installed_at TEXT NOT NULL, PRIMARY KEY(tenant_id, id));
--> statement-breakpoint
CREATE TABLE tenant_flow_runs (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, flow_id TEXT NOT NULL, version_id TEXT, mode TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, summary TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE tenant_flow_variables (tenant_id TEXT NOT NULL, flow_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, secret INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL, PRIMARY KEY(tenant_id, flow_id, key));
--> statement-breakpoint
CREATE TABLE tenant_flow_versions (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, flow_id TEXT NOT NULL, definition TEXT NOT NULL, created_at TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE tenant_flows (tenant_id TEXT NOT NULL, flow_id TEXT NOT NULL, definition TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(tenant_id, flow_id));
--> statement-breakpoint
CREATE TABLE tenant_folders (tenant_id TEXT NOT NULL, path TEXT NOT NULL, PRIMARY KEY(tenant_id, path));
--> statement-breakpoint
CREATE TABLE tenant_namespace_migrations (
  old_key TEXT PRIMARY KEY,
  tenant_id BIGINT NOT NULL
);
--> statement-breakpoint
CREATE INDEX savia_request_audit_scope_idx ON savia_request_audit(tenant_id, created_at DESC, id DESC);
--> statement-breakpoint
CREATE INDEX tenant_flow_runs_scope_idx ON tenant_flow_runs(tenant_id, flow_id, created_at);
--> statement-breakpoint
CREATE INDEX tenant_flow_versions_scope_idx ON tenant_flow_versions(tenant_id, flow_id, created_at);
