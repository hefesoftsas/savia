import { tenantSlugFromName } from "@savia/tenant-host";
import { tenantSlugExists } from "./tenant-slugs";

export class TenantSlugConflictError extends Error {}

export function tenantSlugCandidate(name: string, index: number): string {
  const base = tenantSlugFromName(name);
  const suffix = index ? `-${index + 1}` : "";
  return base.slice(0, 63 - suffix.length).replace(/-+$/, "") + suffix;
}

/** Reserve both old and new names in the same transaction as the tenant update. */
export async function tenantSlugChangeStatements(
  db: D1Database,
  tenantId: number,
  currentSlug: string,
  nextSlug: string,
): Promise<D1PreparedStatement[]> {
  if (currentSlug === nextSlug) return [];
  const owner = await db
    .prepare("SELECT tenant_id FROM tenant_slug_aliases WHERE slug=?")
    .bind(nextSlug)
    .first<{ tenant_id: number }>();
  if (owner && owner.tenant_id !== tenantId)
    throw new TenantSlugConflictError("Tenant URL is already reserved");
  if (!owner && (await tenantSlugExists(db, nextSlug)))
    throw new TenantSlugConflictError("Tenant URL is already reserved");
  return [
    db
      .prepare(
        "INSERT INTO tenant_slug_aliases(slug,tenant_id) VALUES(?,?) ON CONFLICT(slug) DO NOTHING",
      )
      .bind(currentSlug, tenantId),
    ...(owner
      ? []
      : [
          db
            .prepare(
              "INSERT INTO tenant_slug_aliases(slug,tenant_id) VALUES(?,?)",
            )
            .bind(nextSlug, tenantId),
        ]),
  ];
}
