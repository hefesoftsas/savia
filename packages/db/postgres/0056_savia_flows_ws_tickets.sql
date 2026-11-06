CREATE TABLE savia_flows_ws_tickets (
    jti text PRIMARY KEY NOT NULL,
    principal_id text NOT NULL REFERENCES identity_principal(id) ON DELETE CASCADE,
    tenant_id bigint NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    path text NOT NULL,
    expires_at bigint NOT NULL,
    created_at bigint NOT NULL
);
CREATE INDEX savia_flows_ws_tickets_expiry ON savia_flows_ws_tickets(expires_at);
