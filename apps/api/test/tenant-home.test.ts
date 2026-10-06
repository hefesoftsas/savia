import { OpenAPIHono } from "@hono/zod-openapi";
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { registerTenantHomeRoutes } from "../src/tenant-home/routes";

const migrations = Object.entries(
  import.meta.glob<string>("../../../packages/db/migrations/*.sql", {
    eager: true,
    import: "default",
    query: "?raw",
  }),
)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([, source]) => source);

beforeAll(async () => {
  for (const sql of migrations)
    for (const statement of sql
      .split("--> statement-breakpoint")
      .map((entry) =>
        entry
          .replace(/^--.*$/gm, "")
          .replace(/\s+/g, " ")
          .trim(),
      )
      .filter(Boolean))
      await env.DB.exec(statement);
});

function app() {
  const api = new OpenAPIHono();
  registerTenantHomeRoutes(api, env.DB, "test-bridge-key");
  return api;
}

async function createTenant(id: number, slug: string) {
  const now = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO tenants(id,id_slug,name,kind,is_active,created_at,updated_at) VALUES(?,?,?,'commercial',1,?,?) ON CONFLICT(id) DO NOTHING",
  )
    .bind(id, slug, "Home Tenant", now, now)
    .run();
}

describe("internal tenant home", () => {
  it("returns the slug for an active commercial tenant", async () => {
    await createTenant(992001, "home-tenant");
    const response = await app().request("/_internal/tenants/992001/home", {
      headers: { "x-savia-bridge-key": "test-bridge-key" },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      id: 992001,
      slug: "home-tenant",
      currentSlug: null,
      currentTenantId: null,
    });
  });

  it("resolves the tenant serving the current hostname", async () => {
    await createTenant(992002, "current-home");
    const canonical = await app().request(
      "/_internal/tenants/992002/home?host=savia.app.hefesoft.com",
      { headers: { "x-savia-bridge-key": "test-bridge-key" } },
    );
    expect(await canonical.json()).toEqual({
      id: 992002,
      slug: "current-home",
      currentSlug: null,
      currentTenantId: null,
    });

    const dedicated = await app().request(
      "/_internal/tenants/992002/home?host=current-home.savia.app.hefesoft.com",
      { headers: { "x-savia-bridge-key": "test-bridge-key" } },
    );
    expect(await dedicated.json()).toEqual({
      id: 992002,
      slug: "current-home",
      currentSlug: "current-home",
      currentTenantId: 992002,
    });

    const unknown = await app().request(
      "/_internal/tenants/992002/home?host=unknown.savia.app.hefesoft.com",
      { headers: { "x-savia-bridge-key": "test-bridge-key" } },
    );
    expect(await unknown.json()).toEqual({
      id: 992002,
      slug: "current-home",
      currentSlug: "unknown",
      currentTenantId: null,
    });
  });

  it("rejects missing bridge key and unknown tenants", async () => {
    const missingKey = await app().request("/_internal/tenants/992001/home");
    expect(missingKey.status).toBe(401);

    const unknown = await app().request("/_internal/tenants/999999998/home", {
      headers: { "x-savia-bridge-key": "test-bridge-key" },
    });
    expect(unknown.status).toBe(404);
  });
});
