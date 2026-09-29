-- Native PostgreSQL initial schema snapshot generated from the final applied migration chain.
-- Seed rows are kept in 0002_bootstrap.sql and remain conditional on savia.seed.
SET LOCAL check_function_bodies TO false;

CREATE FUNCTION savia_request.savia_json_valid(value text) RETURNS boolean
    LANGUAGE plpgsql IMMUTABLE
    AS $$
BEGIN PERFORM value::json; RETURN value IS NOT NULL;
EXCEPTION WHEN invalid_text_representation THEN RETURN false;
END $$;
CREATE TABLE savia_request.bundle_flow_state (
    scope text NOT NULL,
    flow_id text NOT NULL,
    bundle_version text NOT NULL,
    content_hash text NOT NULL,
    updated_at text NOT NULL
);
CREATE TABLE savia_request.flow_runs (
    id text NOT NULL,
    flow_id text NOT NULL,
    version_id text,
    mode text NOT NULL,
    status text NOT NULL,
    created_at text NOT NULL,
    summary text NOT NULL
);
CREATE TABLE savia_request.flow_variables (
    flow_id text NOT NULL,
    key text NOT NULL,
    value text NOT NULL,
    secret bigint DEFAULT 0 NOT NULL
);
CREATE TABLE savia_request.flow_versions (
    id text NOT NULL,
    flow_id text NOT NULL,
    definition text NOT NULL,
    created_at text NOT NULL
);
CREATE TABLE savia_request.flows (
    id text NOT NULL,
    definition text NOT NULL
);
CREATE TABLE savia_request.folders (
    path text NOT NULL
);
CREATE TABLE savia_request.installed_bundles (
    id text NOT NULL,
    version text NOT NULL,
    installed_at text NOT NULL
);
CREATE TABLE savia_request.savia_request_audit (
    id text NOT NULL,
    tenant_id text NOT NULL,
    actor text NOT NULL,
    action text NOT NULL,
    flow_id text,
    detail text,
    created_at text NOT NULL
);
CREATE TABLE savia_request.tenant_bundles (
    tenant_id text NOT NULL,
    id text NOT NULL,
    version text NOT NULL,
    installed_at text NOT NULL
);
CREATE TABLE savia_request.tenant_flow_runs (
    id text NOT NULL,
    tenant_id text NOT NULL,
    flow_id text NOT NULL,
    version_id text,
    mode text NOT NULL,
    status text NOT NULL,
    created_at text NOT NULL,
    summary text NOT NULL
);
CREATE TABLE savia_request.tenant_flow_variables (
    tenant_id text NOT NULL,
    flow_id text NOT NULL,
    key text NOT NULL,
    value text NOT NULL,
    secret bigint DEFAULT 0 NOT NULL,
    updated_at text NOT NULL
);
CREATE TABLE savia_request.tenant_flow_versions (
    id text NOT NULL,
    tenant_id text NOT NULL,
    flow_id text NOT NULL,
    definition text NOT NULL,
    created_at text NOT NULL
);
CREATE TABLE savia_request.tenant_flows (
    tenant_id text NOT NULL,
    flow_id text NOT NULL,
    definition text NOT NULL,
    updated_at text NOT NULL
);
CREATE TABLE savia_request.tenant_folders (
    tenant_id text NOT NULL,
    path text NOT NULL
);
CREATE TABLE savia_request.tenant_namespace_migrations (
    old_key text NOT NULL,
    tenant_id bigint NOT NULL
);
ALTER TABLE ONLY savia_request.bundle_flow_state
    ADD CONSTRAINT bundle_flow_state_pkey PRIMARY KEY (scope, flow_id);
ALTER TABLE ONLY savia_request.flow_runs
    ADD CONSTRAINT flow_runs_pkey PRIMARY KEY (id);
ALTER TABLE ONLY savia_request.flow_variables
    ADD CONSTRAINT flow_variables_pkey PRIMARY KEY (flow_id, key);
ALTER TABLE ONLY savia_request.flow_versions
    ADD CONSTRAINT flow_versions_pkey PRIMARY KEY (id);
ALTER TABLE ONLY savia_request.flows
    ADD CONSTRAINT flows_pkey PRIMARY KEY (id);
ALTER TABLE ONLY savia_request.folders
    ADD CONSTRAINT folders_pkey PRIMARY KEY (path);
ALTER TABLE ONLY savia_request.installed_bundles
    ADD CONSTRAINT installed_bundles_pkey PRIMARY KEY (id);
ALTER TABLE ONLY savia_request.savia_request_audit
    ADD CONSTRAINT savia_request_audit_pkey PRIMARY KEY (id);
ALTER TABLE ONLY savia_request.tenant_bundles
    ADD CONSTRAINT tenant_bundles_pkey PRIMARY KEY (tenant_id, id);
ALTER TABLE ONLY savia_request.tenant_flow_runs
    ADD CONSTRAINT tenant_flow_runs_pkey PRIMARY KEY (id);
ALTER TABLE ONLY savia_request.tenant_flow_variables
    ADD CONSTRAINT tenant_flow_variables_pkey PRIMARY KEY (tenant_id, flow_id, key);
ALTER TABLE ONLY savia_request.tenant_flow_versions
    ADD CONSTRAINT tenant_flow_versions_pkey PRIMARY KEY (id);
ALTER TABLE ONLY savia_request.tenant_flows
    ADD CONSTRAINT tenant_flows_pkey PRIMARY KEY (tenant_id, flow_id);
ALTER TABLE ONLY savia_request.tenant_folders
    ADD CONSTRAINT tenant_folders_pkey PRIMARY KEY (tenant_id, path);
ALTER TABLE ONLY savia_request.tenant_namespace_migrations
    ADD CONSTRAINT tenant_namespace_migrations_pkey PRIMARY KEY (old_key);
CREATE INDEX savia_request_audit_scope_idx ON savia_request.savia_request_audit USING btree (tenant_id, created_at DESC, id DESC);
CREATE INDEX tenant_flow_runs_scope_idx ON savia_request.tenant_flow_runs USING btree (tenant_id, flow_id, created_at);
CREATE INDEX tenant_flow_versions_scope_idx ON savia_request.tenant_flow_versions USING btree (tenant_id, flow_id, created_at);
