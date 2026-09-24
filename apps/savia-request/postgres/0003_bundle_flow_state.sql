-- Per-flow bundle provenance: distinguishes pristine installs (safe to
-- update) from tenant/manual customizations (skipped unless forced).
-- scope "" is the platform catalog; otherwise a tenant id.
CREATE TABLE bundle_flow_state (scope TEXT NOT NULL, flow_id TEXT NOT NULL, bundle_version TEXT NOT NULL, content_hash TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(scope, flow_id));
