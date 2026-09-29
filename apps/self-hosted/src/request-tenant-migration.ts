/** Transfer migration provenance between the separate core and Request stores. */
export async function seedRequestTenantMigration(
  core: D1Database,
  request: D1Database,
): Promise<void> {
  const mappings = await core
    .prepare("SELECT old_key,tenant_id FROM tenant_namespace_migrations")
    .all<{ old_key: string; tenant_id: number }>();
  await request
    .prepare(
      "CREATE TABLE IF NOT EXISTS tenant_namespace_migrations (old_key TEXT PRIMARY KEY, tenant_id BIGINT NOT NULL)",
    )
    .run();
  const existing = await request
    .prepare("SELECT old_key,tenant_id FROM tenant_namespace_migrations")
    .all<{ old_key: string; tenant_id: number }>();
  const known = new Map(
    existing.results.map((row) => [row.old_key, row.tenant_id]),
  );
  for (const row of mappings.results) {
    if (known.has(row.old_key) && known.get(row.old_key) !== row.tenant_id)
      throw new Error(
        `Request tenant migration conflicts with core mapping: ${row.old_key}`,
      );
  }
  const missing = mappings.results.filter((row) => !known.has(row.old_key));
  if (missing.length)
    await request.batch(
      missing.map((row) =>
        request
          .prepare(
            "INSERT INTO tenant_namespace_migrations(old_key,tenant_id) VALUES(?,?) ON CONFLICT(old_key) DO NOTHING",
          )
          .bind(row.old_key, row.tenant_id),
      ),
    );
}
