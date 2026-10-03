import { env } from "cloudflare:workers";
import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeAll, expect, it } from "vitest";
import { authenticationMiddleware } from "../src/auth/middleware";
import type { AppActor, Authenticator } from "../src/auth/types";
import { registerPagesSearchSettingsRoutes } from "../src/routes/pages-search-settings";
import { readPagesSearchSettings } from "../src/pages/search-settings";

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

let nextTenantId = 989000;
async function createTenant(active = true, kind = "commercial") {
  const id = ++nextTenantId;
  const now = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO tenants(id,id_slug,name,kind,is_active,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
  )
    .bind(
      id,
      `pages-search-${id}`,
      `Pages Search ${id}`,
      kind,
      active ? 1 : 0,
      now,
      now,
    )
    .run();
  return id;
}

function actor(
  globalRoles: AppActor["globalRoles"] = [],
  tenantId?: number,
  role = "tenant_admin",
  principalIsActive = true,
): AppActor {
  return {
    principal: {
      id: "pages-search-test-actor",
      issuer: "savia:test",
      subject: "pages-search-test-actor",
      email: "pages-search@example.test",
      displayName: "Pages Search Test Actor",
      isActive: principalIsActive,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    globalRoles,
    memberships:
      tenantId === undefined
        ? []
        : [
            {
              id: `pages-search-membership-${tenantId}`,
              principalId: "pages-search-test-actor",
              agencyId: tenantId,
              tenantId,
              role,
              isActive: true,
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
          ],
  };
}

function appFor(testActor: AppActor) {
  const app = new OpenAPIHono();
  const authenticator: Authenticator = {
    async authenticate() {
      return testActor;
    },
  };
  app.use("/v1/*", authenticationMiddleware(env.DB, authenticator));
  registerPagesSearchSettingsRoutes(app, env.DB);
  return app;
}

const put = (body: unknown) => ({
  method: "PUT",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

it("defaults both gates off and requires both platform grant and tenant enablement", async () => {
  const tenantId = await createTenant();
  const path = `https://api.test/v1/tenants/${tenantId}/pages-search-settings`;
  const platform = appFor(actor(["platform_admin"]));
  const tenantAdmin = appFor(actor([], tenantId));

  expect(await readPagesSearchSettings(env.DB, tenantId)).toEqual({
    tenantId,
    allowed: false,
    enabled: false,
    effectiveEnabled: false,
  });
  const initial = await tenantAdmin.request(path);
  expect(initial.status).toBe(200);
  expect(await initial.json()).toEqual({
    data: {
      tenantId,
      allowed: false,
      enabled: false,
      effectiveEnabled: false,
      canGrant: false,
    },
  });
  expect(initial.headers.get("cache-control")).toBe("no-store");

  const grant = await platform.request(path, put({ allowed: true }));
  expect(grant.status).toBe(200);
  expect(await grant.json()).toMatchObject({
    data: {
      allowed: true,
      enabled: false,
      effectiveEnabled: false,
      canGrant: true,
    },
  });
  expect((await tenantAdmin.request(path, put({ enabled: true }))).status).toBe(
    200,
  );
  expect(await readPagesSearchSettings(env.DB, tenantId)).toEqual({
    tenantId,
    allowed: true,
    enabled: true,
    effectiveEnabled: true,
  });

  expect((await platform.request(path, put({ allowed: false }))).status).toBe(
    200,
  );
  expect(await readPagesSearchSettings(env.DB, tenantId)).toEqual({
    tenantId,
    allowed: false,
    enabled: false,
    effectiveEnabled: false,
  });
  expect((await platform.request(path, put({ allowed: true }))).status).toBe(
    200,
  );
  expect(await readPagesSearchSettings(env.DB, tenantId)).toEqual({
    tenantId,
    allowed: true,
    enabled: false,
    effectiveEnabled: false,
  });
});

it("limits grant changes to platform admins and rejects disallowed enablement", async () => {
  const tenantId = await createTenant();
  const path = `https://api.test/v1/tenants/${tenantId}/pages-search-settings`;
  const platform = appFor(actor(["platform_admin"]));
  const tenantAdmin = appFor(actor([], tenantId));
  expect((await tenantAdmin.request(path, put({ enabled: true }))).status).toBe(
    403,
  );
  expect(
    (await tenantAdmin.request(path, put({ allowed: false }))).status,
  ).toBe(403);
  expect((await platform.request(path, put({ enabled: true }))).status).toBe(
    400,
  );
  expect(
    (await platform.request(path, put({ allowed: false, enabled: true })))
      .status,
  ).toBe(400);
  expect((await platform.request(path, put({}))).status).toBe(400);
  expect(
    (await platform.request(path, put({ enabled: true, extra: true }))).status,
  ).toBe(400);
});

it("requires an active tenant administrator for tenant access and an active tenant", async () => {
  const tenantId = await createTenant();
  const otherTenantId = await createTenant();
  const inactiveTenantId = await createTenant(false);
  const path = (id: number) =>
    `https://api.test/v1/tenants/${id}/pages-search-settings`;
  const unrelatedAdmin = appFor(actor([], otherTenantId));
  const ordinaryMember = appFor(actor([], tenantId, "viewer"));
  const agencyAdmin = appFor(actor([], tenantId, "agency_admin"));
  const inactivePrincipal = appFor(actor([], tenantId, "tenant_admin", false));
  const platform = appFor(actor(["platform_admin"]));

  expect(
    (await platform.request(path(tenantId), put({ allowed: true }))).status,
  ).toBe(200);
  expect(
    (await agencyAdmin.request(path(tenantId), put({ enabled: true }))).status,
  ).toBe(200);
  expect((await unrelatedAdmin.request(path(tenantId))).status).toBe(403);
  expect(
    (await unrelatedAdmin.request(path(tenantId), put({ enabled: false })))
      .status,
  ).toBe(403);
  expect((await ordinaryMember.request(path(tenantId))).status).toBe(403);
  expect(
    (await ordinaryMember.request(path(tenantId), put({ enabled: false })))
      .status,
  ).toBe(403);
  expect((await inactivePrincipal.request(path(tenantId))).status).toBe(403);
  expect((await platform.request(path(inactiveTenantId))).status).toBe(404);
  expect(
    (await platform.request(path(await createTenant(true, "platform")))).status,
  ).toBe(404);
  expect((await platform.request(path(99999999))).status).toBe(404);
});

it("lets platform admins activate an existing grant with an enabled-only patch", async () => {
  const tenantId = await createTenant();
  const path = `https://api.test/v1/tenants/${tenantId}/pages-search-settings`;
  const platform = appFor(actor(["platform_admin"]));
  expect((await platform.request(path, put({ allowed: true }))).status).toBe(
    200,
  );
  const enabled = await platform.request(path, put({ enabled: true }));
  expect(enabled.status).toBe(200);
  expect(await enabled.json()).toMatchObject({
    data: { allowed: true, enabled: true, effectiveEnabled: true },
  });
  expect((await platform.request(path, put({ enabled: false }))).status).toBe(
    200,
  );
  expect(await readPagesSearchSettings(env.DB, tenantId)).toMatchObject({
    allowed: true,
    enabled: false,
  });
});
