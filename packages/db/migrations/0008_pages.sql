CREATE TABLE pages (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id INTEGER NOT NULL,
  owner_id TEXT NOT NULL,
  parent_id TEXT REFERENCES pages(id) ON DELETE CASCADE,
  root_id TEXT NOT NULL,
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 200),
  content_json TEXT NOT NULL DEFAULT '[]',
  search_text TEXT NOT NULL DEFAULT '',
  binding_json TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  share_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(owner_id) REFERENCES identity_principal(id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX pages_tenant_owner_updated ON pages(tenant_id, owner_id, updated_at DESC);
--> statement-breakpoint
CREATE INDEX pages_parent_order ON pages(parent_id, updated_at DESC);
--> statement-breakpoint
CREATE INDEX pages_root ON pages(root_id);
--> statement-breakpoint
CREATE TABLE page_revisions (
  page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  title TEXT NOT NULL,
  content_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(page_id, version)
);
--> statement-breakpoint
CREATE TABLE page_shares (
  root_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  tenant_id INTEGER NOT NULL,
  principal_id TEXT NOT NULL REFERENCES identity_principal(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('reader', 'editor')),
  created_at TEXT NOT NULL,
  PRIMARY KEY(root_id, principal_id)
);
--> statement-breakpoint
CREATE INDEX page_shares_principal ON page_shares(principal_id, tenant_id);
--> statement-breakpoint
CREATE TABLE page_files (
  id TEXT PRIMARY KEY NOT NULL,
  page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  root_id TEXT NOT NULL,
  tenant_id INTEGER NOT NULL,
  storage_key TEXT NOT NULL UNIQUE,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX page_files_page ON page_files(page_id);
