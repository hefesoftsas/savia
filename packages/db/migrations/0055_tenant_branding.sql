CREATE TABLE tenant_branding (
 tenant_id INTEGER PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
 config TEXT NOT NULL CHECK(json_valid(config)),
 version INTEGER NOT NULL CHECK(version > 0),
 updated_by TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE tenant_branding_assets (
 id TEXT PRIMARY KEY,
 tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 kind TEXT NOT NULL CHECK(kind IN ('logo','cover')),
 object_key TEXT NOT NULL UNIQUE,
 state TEXT NOT NULL DEFAULT 'live' CHECK(state IN ('live','uploading','deleting')),
 content_type TEXT NOT NULL CHECK(content_type IN ('image/png','image/jpeg','image/webp')),
 size INTEGER NOT NULL CHECK(size > 0 AND size <= 2097152),
 created_by TEXT NOT NULL,
 created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX tenant_branding_assets_tenant ON tenant_branding_assets(tenant_id);
