import { env } from "cloudflare:workers";
import { beforeAll, expect, it } from "vitest";
import { resolveTenantSlug, tenantSlugExists } from "../src/tenant-slugs";

const migrations = Object.entries(
  import.meta.glob<string>("../../../packages/db/migrations/*.sql", {
    eager: true,
    import: "default",
    query: "?raw",
  }),
)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([, sql]) => sql);

beforeAll(async () => {
  for (const sql of migrations)
    for (const statement of sql
      .split("--> statement-breakpoint")
      .map((part) =>
        part
          .replace(/^--.*$/gm, "")
          .replace(/\s+/g, " ")
          .trim(),
      )
      .filter(Boolean))
      await env.DB.exec(statement);
});

it("reserves canonical slugs and checks both sources in the shared namespace", async () => {
  // The migration backfills every existing tenant, including the platform row.
  expect(await tenantSlugExists(env.DB, "savia-platform")).toBe(true);

  await env.DB.prepare(
    "INSERT INTO tenants(id,id_slug,name,is_active,created_at,updated_at,kind) VALUES(?,?,?,?,?,?,?)",
  )
    .bind(
      982001,
      "unregistered-canonical",
      "Canonical",
      1,
      "now",
      "now",
      "commercial",
    )
    .run();
  expect(await tenantSlugExists(env.DB, "unregistered-canonical")).toBe(true);

  await env.DB.prepare(
    "INSERT INTO tenant_slug_aliases(slug,tenant_id) VALUES(?,?)",
  )
    .bind("previous-canonical", 982001)
    .run();
  expect(await tenantSlugExists(env.DB, "previous-canonical")).toBe(true);
});

it("resolves canonical names and aliases only for active commercial tenants", async () => {
  await env.DB.prepare(
    "INSERT INTO tenants(id,id_slug,name,is_active,created_at,updated_at,kind) VALUES(?,?,?,?,?,?,?),(?,?,?,?,?,?,?)",
  )
    .bind(
      982002,
      "resolvable-canonical",
      "Resolvable tenant",
      1,
      "now",
      "now",
      "commercial",
      982003,
      "inactive-canonical",
      "Inactive tenant",
      0,
      "now",
      "now",
      "commercial",
    )
    .run();
  await env.DB.prepare(
    "INSERT INTO tenant_slug_aliases(slug,tenant_id) VALUES(?,?)",
  )
    .bind("resolvable-legacy", 982002)
    .run();

  const canonical = await resolveTenantSlug(env.DB, "resolvable-canonical");
  const alias = await resolveTenantSlug(env.DB, "resolvable-legacy");
  expect(canonical).toEqual({
    id: 982002,
    idSlug: "resolvable-canonical",
    name: "Resolvable tenant",
    kind: "commercial",
    isActive: 1,
  });
  expect(alias).toEqual(canonical);
  expect(await resolveTenantSlug(env.DB, "inactive-canonical")).toBeNull();
  expect(await resolveTenantSlug(env.DB, "savia-platform")).toBeNull();
  expect(await resolveTenantSlug(env.DB, "unknown-tenant")).toBeNull();
});
