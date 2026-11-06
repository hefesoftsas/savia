import { env } from "cloudflare:workers";
import { beforeAll, expect, it } from "vitest";
import type { AppActor } from "../src/auth/types";
import { createTestApp } from "./test-app";

const migrations = Object.entries(
  import.meta.glob<string>("../../../packages/db/migrations/*.sql", {
    eager: true,
    import: "default",
    query: "?raw",
  }),
).sort(([a], [b]) => a.localeCompare(b));

async function apply(sql: string) {
  for (const statement of sql.split("--> statement-breakpoint")) {
    const normalized = statement
      .replace(/^--.*$/gm, "")
      .replace(/\s+/g, " ")
      .trim();
    if (normalized) await env.DB.exec(normalized);
  }
}

const actor = (global = false, tenantId?: number): AppActor => ({
  principal: {
    id: `tenant-catalog-${global ? "platform" : tenantId}`,
    issuer: "savia:test",
    subject: `tenant-catalog-${global ? "platform" : tenantId}`,
    email: "tenant-catalog@test.org",
    displayName: "Tenant Catalog",
    isActive: true,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  },
  globalRoles: global ? ["platform_admin"] : [],
  memberships: tenantId
    ? [
        {
          id: `catalog-membership-${tenantId}`,
          principalId: `tenant-catalog-${tenantId}`,
          agencyId: tenantId,
          tenantId,
          role: "tenant_admin",
          isActive: true,
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
        },
      ]
    : [],
});

beforeAll(async () => {
  for (const [, sql] of migrations) await apply(sql);
  for (const id of [98201, 98202])
    await env.DB.prepare(
      "INSERT OR IGNORE INTO tenants(id,id_slug,name,kind,is_active,created_at,updated_at) VALUES(?,?,?,'commercial',1,'2026-01-01','2026-01-01')",
    )
      .bind(id, `catalog-${id}`, `Catalog ${id}`)
      .run();
});

it("lists only authorized active tenant workspaces and exposes tenant zero only to platform admins", async () => {
  const admin = createTestApp({
    documents: env.DOCUMENTS,
    auth: { authenticate: async () => actor(true) },
  });
  const adminResponse = await admin.request("/v1/tenant-workspaces");
  expect(adminResponse.status).toBe(200);
  const adminData = (await adminResponse.json()).data as Array<
    Record<string, unknown>
  >;
  expect(adminData).toContainEqual({
    id: "tenant:0",
    tenantId: 0,
    label: "Plataforma Savia",
    kind: "platform",
    apiBasePath: "/v1/studio/0",
  });
  expect((await admin.request("/v1/studio/0/api/objects")).status).toBe(200);
  expect(adminData).toContainEqual({
    id: "tenant:98201",
    tenantId: 98201,
    label: "Catalog 98201",
    kind: "tenant",
    apiBasePath: "/v1/studio/98201",
  });

  const member = createTestApp({
    auth: { authenticate: async () => actor(false, 98201) },
  });
  const memberResponse = await member.request("/v1/tenant-workspaces");
  expect(memberResponse.status).toBe(200);
  const memberData = (await memberResponse.json()).data as Array<
    Record<string, unknown>
  >;
  expect(memberData.map((item) => item.id)).toEqual(["tenant:98201"]);
  expect((await member.request("/v1/studio/0/api/objects")).status).toBe(404);
  expect((await member.request("/v1/studio/98202/api/objects")).status).toBe(
    403,
  );
});

it("removes the data-domain catalog, creation, and runtime routes", async () => {
  const app = createTestApp({
    auth: { authenticate: async () => actor(true) },
  });
  expect((await app.request("/v1/data-domains")).status).toBe(404);
  expect(
    (
      await app.request("/v1/data-domains", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "new_space", label: "New space" }),
      })
    ).status,
  ).toBe(404);
  expect(
    (await app.request("/v1/data-domains/legacy/api/objects")).status,
  ).toBe(404);
});
