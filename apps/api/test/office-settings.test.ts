import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { OpenAPIHono } from "@hono/zod-openapi";
import type { AppActor, Authenticator } from "../src/auth/types";
import { authenticationMiddleware } from "../src/auth/middleware";
import { registerOfficeSettingsRoutes } from "../src/routes/office-settings";

const migrations = Object.entries(
  import.meta.glob<string>("../../../packages/db/migrations/*.sql", {
    eager: true,
    import: "default",
    query: "?raw",
  }),
).sort(([a], [b]) => a.localeCompare(b));

async function applyMigrations() {
  for (const [, sql] of migrations)
    for (const statement of sql.split("--> statement-breakpoint")) {
      const normalized = statement
        .replace(/^--.*$/gm, "")
        .replace(/\s+/g, " ")
        .trim();
      if (normalized) await env.DB.exec(normalized);
    }
}

const actor = (
  id: string,
  tenantId: number,
  role: string,
  globalRoles: AppActor["globalRoles"] = [],
): AppActor => ({
  principal: {
    id,
    issuer: "savia:test",
    subject: id,
    email: `${id}@savia.test`,
    displayName: id,
    isActive: true,
    createdAt: "2026-09-05T00:00:00.000Z",
    updatedAt: "2026-09-05T00:00:00.000Z",
  },
  globalRoles,
  memberships: [
    {
      id: `membership-${id}`,
      principalId: id,
      agencyId: tenantId,
      tenantId,
      role,
      isActive: true,
      createdAt: "2026-09-05T00:00:00.000Z",
      updatedAt: "2026-09-05T00:00:00.000Z",
    },
  ],
});

function appFor(user: AppActor) {
  const app = new OpenAPIHono();
  const auth: Authenticator = {
    async authenticate() {
      return user;
    },
  };
  app.use("*", authenticationMiddleware(env.DB, auth));
  registerOfficeSettingsRoutes(app, env.DB);
  return app;
}

async function seed() {
  await env.DB.prepare(
    "DELETE FROM office_settings WHERE tenant_id IN (9471,9472)",
  ).run();
  await env.DB.prepare(
    "DELETE FROM identity_tenant_membership WHERE tenant_id IN (9471,9472)",
  ).run();
  await env.DB.prepare(
    "DELETE FROM identity_global_role WHERE principal_id IN ('office-settings-platform','office-settings-admin','office-settings-viewer')",
  ).run();
  await env.DB.prepare(
    "DELETE FROM identity_principal WHERE id IN ('office-settings-platform','office-settings-admin','office-settings-viewer')",
  ).run();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO tenants(id,id_slug,name,is_active,created_at,updated_at) VALUES
    (9471,'office-settings-one','Office Settings One',1,'2026-09-05','2026-09-05'),
    (9472,'office-settings-two','Office Settings Two',1,'2026-09-05','2026-09-05')`,
  ).run();
  for (const id of [
    "office-settings-platform",
    "office-settings-admin",
    "office-settings-viewer",
  ]) {
    await env.DB.prepare(
      `INSERT INTO identity_principal(id,issuer,subject,email,display_name,is_active,created_at,updated_at)
      VALUES (?,'savia:test',?,?,?,1,'2026-09-05','2026-09-05')`,
    )
      .bind(id, id, `${id}@savia.test`, id)
      .run();
  }
  await env.DB.prepare(
    "INSERT INTO identity_global_role(principal_id,role,created_at) VALUES ('office-settings-platform','platform_admin','2026-09-05')",
  ).run();
  for (const [id, tenant, role] of [
    ["office-settings-admin", 9471, "tenant_admin"],
    ["office-settings-viewer", 9471, "viewer"],
  ] as const) {
    await env.DB.prepare(
      `INSERT INTO identity_tenant_membership(id,principal_id,tenant_id,role,is_active,created_at,updated_at)
      VALUES (?,?,?,?,1,'2026-09-05','2026-09-05')`,
    )
      .bind(`membership-${id}`, id, tenant, role)
      .run();
  }
}

const json = (response: Response) => response.json() as Promise<any>;

describe("office suite tenant settings", () => {
  beforeAll(applyMigrations);
  beforeEach(seed);

  it("defaults to enabled, scopes current settings to active tenant, and composes platform and tenant controls", async () => {
    const tenantAdmin = appFor(
      actor("office-settings-admin", 9471, "tenant_admin"),
    );
    const initial = await tenantAdmin.request("/v1/office-settings");
    expect(initial.status).toBe(200);
    expect((await json(initial)).data).toEqual({
      tenantId: 9471,
      platformAllowed: true,
      tenantEnabled: true,
      enabled: true,
      canManagePlatform: false,
      canManageTenant: true,
    });

    const otherTenant = await tenantAdmin.request(
      "/v1/tenants/9472/office-settings",
    );
    expect(otherTenant.status).toBe(404);

    const platform = appFor(
      actor("office-settings-platform", 9471, "viewer", []),
    );
    const platformRead = await platform.request(
      "/v1/tenants/9471/office-settings",
    );
    expect((await json(platformRead)).data.canManagePlatform).toBe(true);
    const platformWorkspace = await platform.request(
      "/v1/tenants/0/office-settings",
    );
    expect((await json(platformWorkspace)).data).toEqual({
      tenantId: 0,
      platformAllowed: true,
      tenantEnabled: true,
      enabled: true,
      canManagePlatform: false,
      canManageTenant: false,
    });
    expect(
      (
        await platform.request("/v1/tenants/0/office-settings", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ tenantEnabled: false }),
        })
      ).status,
    ).toBe(403);
    expect(
      (await tenantAdmin.request("/v1/tenants/0/office-settings")).status,
    ).toBe(404);
    const disabled = await platform.request(
      "/v1/tenants/9471/office-settings",
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ platformAllowed: false }),
      },
    );
    expect(disabled.status).toBe(200);
    expect((await json(disabled)).data).toMatchObject({
      platformAllowed: false,
      tenantEnabled: true,
      enabled: false,
    });

    const forbiddenOverride = await tenantAdmin.request(
      "/v1/tenants/9471/office-settings",
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ platformAllowed: true }),
      },
    );
    expect(forbiddenOverride.status).toBe(403);
    const tenantDisabled = await tenantAdmin.request(
      "/v1/tenants/9471/office-settings",
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tenantEnabled: false }),
      },
    );
    expect((await json(tenantDisabled)).data).toMatchObject({
      platformAllowed: false,
      tenantEnabled: false,
      enabled: false,
    });
    const tenantCannotOverridePlatform = await tenantAdmin.request(
      "/v1/tenants/9471/office-settings",
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tenantEnabled: true }),
      },
    );
    expect((await json(tenantCannotOverridePlatform)).data).toMatchObject({
      platformAllowed: false,
      tenantEnabled: true,
      enabled: false,
    });
    const platformReenabled = await platform.request(
      "/v1/tenants/9471/office-settings",
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ platformAllowed: true }),
      },
    );
    expect((await json(platformReenabled)).data).toMatchObject({
      platformAllowed: true,
      tenantEnabled: true,
      enabled: true,
    });
    const tenantReenabled = await tenantAdmin.request(
      "/v1/tenants/9471/office-settings",
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tenantEnabled: false }),
      },
    );
    expect((await json(tenantReenabled)).data.enabled).toBe(false);

    const viewer = appFor(actor("office-settings-viewer", 9471, "viewer"));
    const viewerRead = await viewer.request("/v1/tenants/9471/office-settings");
    expect(viewerRead.status).toBe(200);
    expect((await json(viewerRead)).data.canManageTenant).toBe(false);
    const viewerWrite = await viewer.request(
      "/v1/tenants/9471/office-settings",
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tenantEnabled: true }),
      },
    );
    expect(viewerWrite.status).toBe(403);
  });

  it("uses active database roles and memberships for management authorization", async () => {
    const stalePlatformClaim = appFor(
      actor("office-settings-admin", 9471, "tenant_admin", ["platform_admin"]),
    );
    const cannotManagePlatform = await stalePlatformClaim.request(
      "/v1/tenants/9471/office-settings",
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ platformAllowed: false }),
      },
    );
    expect(cannotManagePlatform.status).toBe(403);
    await env.DB.prepare(
      "UPDATE identity_tenant_membership SET is_active=0 WHERE principal_id='office-settings-admin' AND tenant_id=9471",
    ).run();
    const staleTenantAdmin = await stalePlatformClaim.request(
      "/v1/tenants/9471/office-settings",
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tenantEnabled: false }),
      },
    );
    expect(staleTenantAdmin.status).toBe(404);
    expect(
      (await stalePlatformClaim.request("/v1/office-settings")).status,
    ).toBe(404);
  });
});
