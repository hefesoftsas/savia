CREATE TABLE public_quote_links (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id INTEGER NOT NULL,
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
--> statement-breakpoint
CREATE INDEX public_quote_links_tenant_quote
  ON public_quote_links(tenant_id, quote_id, created_at DESC);
--> statement-breakpoint
CREATE INDEX public_quote_links_expiry
  ON public_quote_links(expires_at);
