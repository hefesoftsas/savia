CREATE TABLE tenant_slug_aliases (
    slug text PRIMARY KEY NOT NULL,
    tenant_id bigint NOT NULL REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX tenant_slug_aliases_tenant_id ON tenant_slug_aliases(tenant_id);

INSERT INTO tenant_slug_aliases(slug, tenant_id)
SELECT id_slug, id FROM tenants;
