export async function isSolutionEnabled(
  db: D1Database,
  tenant: string,
  id: string,
) {
  return Boolean(
    await db
      .prepare(
        "SELECT 1 FROM studio_solution_installations WHERE tenant_id=? AND id=? AND enabled=1",
      )
      .bind(tenant, id)
      .first(),
  );
}

export async function disabledSolutionObjects(
  db: D1Database,
  tenant: string,
): Promise<Set<string>> {
  const { results } = await db
    .prepare(
      "SELECT o.object_name FROM studio_solution_objects o JOIN studio_solution_installations s ON s.tenant_id=o.tenant_id AND s.id=o.solution_id WHERE o.tenant_id=? AND s.enabled=0",
    )
    .bind(tenant)
    .all<{ object_name: string }>();
  return new Set(results.map((r) => r.object_name));
}
