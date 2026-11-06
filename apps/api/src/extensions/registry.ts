export async function enabledExtensions(
  db: D1Database,
  tenant: string,
): Promise<string[]> {
  const rows = await db
    .prepare(
      "SELECT id FROM studio_solution_installations WHERE tenant_id=? AND enabled=1",
    )
    .bind(tenant)
    .all<{ id: string }>();
  return rows.results.map((row) => row.id);
}
export async function isInsuranceEnabled(
  db: D1Database,
  tenant: string,
): Promise<boolean> {
  return (await enabledExtensions(db, tenant)).some((id) =>
    ["savia.insurance", "savia.insurance-management"].includes(id),
  );
}
