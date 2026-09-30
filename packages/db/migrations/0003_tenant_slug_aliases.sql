CREATE TABLE tenant_slug_aliases (
 slug TEXT PRIMARY KEY NOT NULL,
 tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX tenant_slug_aliases_tenant_id ON tenant_slug_aliases(tenant_id);
--> statement-breakpoint
INSERT INTO tenant_slug_aliases(slug, tenant_id)
SELECT id_slug, id FROM tenants;
