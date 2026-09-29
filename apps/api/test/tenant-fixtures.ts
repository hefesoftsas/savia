export async function seedTenantAgency(db: D1Database, id: number) {
  await db
    .prepare(
      "INSERT OR IGNORE INTO tenants(id,id_slug,name,is_active,created_at,updated_at,kind) VALUES(?,?,?,1,?,?,'commercial')",
    )
    .bind(
      id,
      `tenant-${id}`,
      `Tenant ${id}`,
      "2026-09-09T00:00:00.000Z",
      "2026-09-09T00:00:00.000Z",
    )
    .run();
}
