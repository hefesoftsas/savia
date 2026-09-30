export type ResolvedTenantSlug = {
  id: number;
  idSlug: string;
  name: string;
  kind: string;
  isActive: number;
};

/**
 * Resolve a public tenant slug against both canonical IDs and reserved aliases.
 * Only active commercial tenants are routable through public tenant hosts.
 */
export async function resolveTenantSlug(
  db: D1Database,
  slug: string,
): Promise<ResolvedTenantSlug | null> {
  return db
    .prepare(
      `SELECT t.id AS id, t.id_slug AS "idSlug", t.name AS name,
              t.kind AS kind, t.is_active AS "isActive"
       FROM tenants t
       WHERE (t.id_slug = ? OR t.id IN (
         SELECT tenant_id FROM tenant_slug_aliases WHERE slug = ?
       ))
         AND t.kind = 'commercial'
         AND t.is_active = 1
       ORDER BY CASE WHEN t.id_slug = ? THEN 0 ELSE 1 END
       LIMIT 1`,
    )
    .bind(slug, slug, slug)
    .first<ResolvedTenantSlug>();
}

/** Check the shared slug namespace, including fixtures or legacy rows whose canonical slug was not registered. */
export async function tenantSlugExists(
  db: D1Database,
  slug: string,
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT slug FROM (
         SELECT id_slug AS slug FROM tenants WHERE id_slug = ?
         UNION ALL
         SELECT slug FROM tenant_slug_aliases WHERE slug = ?
       )
       LIMIT 1`,
    )
    .bind(slug, slug)
    .first<{ slug: string }>();
  return row !== null;
}
