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

describe("internal tenant home", () => {
  it("returns the slug for an active commercial tenant", async () => {
    const id = 992001;
    const now = new Date().toISOString();
    await env.DB.prepare(
      "INSERT INTO tenants(id,id_slug,name,kind,is_active,created_at,updated_at) VALUES(?,?,?,'commercial',1,?,?) ON CONFLICT(id) DO NOTHING",
    )
      .bind(id, "home-tenant", "Home Tenant", now, now)
      .run();
    const response = await app().request(`/_internal/tenants/${id}/home`, {
      headers: { "x-savia-bridge-key": "test-bridge-key" },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id, slug: "home-tenant" });
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
