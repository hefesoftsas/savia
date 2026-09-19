/** Explicit legacy-test adoption; production never implicitly installs a package. */
export async function installInsuranceFixture(
  db: D1Database,
  ...tenants: string[]
) {
  for (const tenant of tenants) {
    await db
      .prepare(
        "INSERT INTO crm_solution_installations(tenant_id,id,version,enabled,manifest) VALUES (?, 'savia.insurance', '0.0.0', 1, ?) ON CONFLICT(tenant_id,id) DO UPDATE SET enabled=1",
      )
      .bind(
        tenant,
        JSON.stringify({
          format: "savia.solution",
          formatVersion: 1,
          id: "savia.insurance",
          version: "0.0.0",
          label: "Seguros (configuración existente)",
          description: "Instalación adoptada para pruebas legadas.",
          requires: ["insurance.quotes"],
          objects: [],
        }),
      )
      .run();
  }
}
