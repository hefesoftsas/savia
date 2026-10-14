CREATE TABLE savia_core.public_quote_links (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id BIGINT NOT NULL,
  action_id TEXT NOT NULL,
  quote_id TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  report_json TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  UNIQUE (tenant_id, action_id),
  CHECK (length(token) = 64)
);
CREATE INDEX public_quote_links_tenant_quote
  ON savia_core.public_quote_links(tenant_id, quote_id, created_at DESC);
CREATE INDEX public_quote_links_expiry
  ON savia_core.public_quote_links(expires_at);
