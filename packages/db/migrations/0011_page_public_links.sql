CREATE TABLE page_public_links (
  id TEXT PRIMARY KEY NOT NULL,
  page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  tenant_id INTEGER NOT NULL,
  token TEXT NOT NULL UNIQUE CHECK(length(token) = 64),
  created_by TEXT NOT NULL REFERENCES identity_principal(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT,
  revoked_at TEXT
);
--> statement-breakpoint
CREATE INDEX page_public_links_page_created ON page_public_links(page_id, created_at DESC);
--> statement-breakpoint
CREATE INDEX page_public_links_creator ON page_public_links(created_by, tenant_id);
