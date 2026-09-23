-- Who changed what in Savia Request, per scope. The worker never sees
-- sessions, so the API gateway forwards the principal id as x-savia-actor.
CREATE TABLE savia_request_audit (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, flow_id TEXT, detail TEXT, created_at TEXT NOT NULL);
CREATE INDEX savia_request_audit_scope_idx ON savia_request_audit(tenant_id, created_at DESC, id DESC);
