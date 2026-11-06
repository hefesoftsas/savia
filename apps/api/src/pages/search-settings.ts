export type PagesSearchSettings = {
  tenantId: number;
  allowed: boolean;
  enabled: boolean;
  effectiveEnabled: boolean;
};

/** Read the two-gate search setting; a missing row is disabled by default. */
export async function readPagesSearchSettings(
  db: D1Database,
  tenantId: number,
): Promise<PagesSearchSettings> {
  const row = await db
    .prepare(
      "SELECT allowed,enabled FROM tenant_pages_search_settings WHERE tenant_id=?",
    )
    .bind(tenantId)
    .first<{ allowed: number; enabled: number }>();
  const allowed = row?.allowed === 1;
  const enabled = row?.enabled === 1;
  return {
    tenantId,
    allowed,
    enabled,
    effectiveEnabled: allowed && enabled,
  };
}
