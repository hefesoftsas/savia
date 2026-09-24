-- Allow per-tenant login Lottie animations alongside logo/cover images.
-- Rebuilds tenant_branding_assets to widen the kind and content_type checks
-- without losing stored assets. Existing rows are preserved verbatim.
CREATE TABLE `tenant_branding_assets__new` (
  id TEXT PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('logo','cover','login-animation')),
  object_key TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL DEFAULT 'live' CHECK(state IN ('live','uploading','deleting')),
  content_type TEXT NOT NULL CHECK(content_type IN ('image/png','image/jpeg','image/webp','application/json')),
  size INTEGER NOT NULL CHECK(size > 0 AND size <= 2097152),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
--> statement-breakpoint
INSERT INTO `tenant_branding_assets__new` SELECT * FROM `tenant_branding_assets`;
--> statement-breakpoint
DROP TABLE `tenant_branding_assets`;
--> statement-breakpoint
ALTER TABLE `tenant_branding_assets__new` RENAME TO `tenant_branding_assets`;
--> statement-breakpoint
CREATE INDEX tenant_branding_assets_tenant ON tenant_branding_assets(tenant_id);
