CREATE TABLE savia_flows_ws_tickets (
 jti TEXT PRIMARY KEY NOT NULL,
 principal_id TEXT NOT NULL REFERENCES identity_principal(id) ON DELETE CASCADE,
 tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 path TEXT NOT NULL,
 expires_at BIGINT NOT NULL,
 created_at BIGINT NOT NULL
);
--> statement-breakpoint
CREATE INDEX savia_flows_ws_tickets_expiry ON savia_flows_ws_tickets(expires_at);
