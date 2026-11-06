/** Run with Node 22.18+. Defaults to a read-only plan; --apply is explicit. */
import { pathToFileURL } from "node:url";
import { tenantSlugFromName } from "../packages/tenant-host/src/tenant-host.ts";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function planTenantSlugMigration(rows, aliases) {
  const occupied = new Set([...rows.map((row) => row.idSlug), ...aliases]);
  const plan = [];
  for (const row of [...rows].sort((a, b) => a.id - b.id)) {
    if (row.kind !== "commercial" || !uuid.test(row.idSlug)) continue;
    const base = tenantSlugFromName(row.name);
    let slug = base;
    for (let index = 2; occupied.has(slug); index++) {
      const suffix = `-${index}`;
      slug = base.slice(0, 63 - suffix.length).replace(/-+$/, "") + suffix;
    }
    occupied.add(slug);
    plan.push({ id: row.id, name: row.name, previousSlug: row.idSlug, slug });
  }
  return plan;
}

export function tenantMigrationBatch(row, now) {
  return [
    {
      sql: "INSERT INTO tenant_slug_aliases(slug,tenant_id) SELECT ?,id FROM tenants WHERE id=? AND id_slug=? ON CONFLICT(slug) DO NOTHING",
      params: [row.previousSlug, row.id, row.previousSlug],
    },
    {
      sql: "INSERT INTO tenant_slug_aliases(slug,tenant_id) SELECT ?,id FROM tenants WHERE id=? AND id_slug=?",
      params: [row.slug, row.id, row.previousSlug],
    },
    {
      sql: "UPDATE tenants SET id_slug=?,updated_at=? WHERE id=? AND id_slug=? RETURNING id",
      params: [row.slug, now, row.id, row.previousSlug],
    },
  ];
}

async function main() {
  const {
    CLOUDFLARE_ACCOUNT_ID: account,
    CLOUDFLARE_DATABASE_ID: database,
    CLOUDFLARE_API_TOKEN: token,
  } = process.env;
  if (!account || !database || !token)
    throw new Error("Cloudflare account, database and API token are required");
  const base = `https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${database}`;
  const headers = {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
  const info = await fetch(base, { headers });
  const details = await info.json();
  // This operational migration is deliberately scoped to preview.
  if (!info.ok || details.result?.name !== "savia-agencies-preview")
    throw new Error("Expected savia-agencies-preview database");
  async function query(input) {
    const response = await fetch(`${base}/query`, {
      method: "POST",
      headers,
      body: JSON.stringify(input),
    });
    const body = await response.json();
    if (
      !response.ok ||
      body.success !== true ||
      body.result?.some((r) => r.success === false)
    )
      throw new Error(`Tenant migration query failed (${response.status})`);
    return body.result;
  }
  const [tenants] = await query({
    sql: "SELECT id,name,id_slug AS idSlug,kind FROM tenants ORDER BY id",
  });
  const [aliases] = await query({
    sql: "SELECT slug FROM tenant_slug_aliases",
  });
  const plan = planTenantSlugMigration(
    tenants.results,
    aliases.results.map((x) => x.slug),
  );
  console.log(
    JSON.stringify(
      {
        database: details.result.name,
        apply: process.argv.includes("--apply"),
        plan,
      },
      null,
      2,
    ),
  );
  if (!process.argv.includes("--apply")) return;
  for (const row of plan) {
    const result = await query({
      batch: tenantMigrationBatch(row, new Date().toISOString()),
    });
    if (result[2].results.length !== 1)
      throw new Error(`Tenant ${row.id} changed concurrently; rerun the plan`);
    console.log(
      `Migrated tenant ${row.id}: ${row.previousSlug} -> ${row.slug}`,
    );
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
