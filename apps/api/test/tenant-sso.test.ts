import { env } from "cloudflare:workers";
import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeAll, expect, it, vi } from "vitest";
import { authenticationMiddleware } from "../src/auth/middleware";
import type { Authenticator } from "../src/auth/types";
import {
  registerTenantSSORoutes,
  setTenantSSOActivity,
} from "../src/tenant-sso/routes";
import { registerTenantRoutes } from "../src/routes/tenants";
import { platformAdministratorAuthenticator } from "./auth-fixtures";

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

let nextId = 989000;
async function createTenant() {
  const id = ++nextId;
  const now = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO tenants(id,id_slug,name,is_active,created_at,updated_at) VALUES(?,?,?,1,?,?)",
  )
    .bind(id, `sso-${id}`, "SSO tenant", now, now)
    .run();
  const principalId = `sso-test-principal-${id}`;
  const subject = `sso-subject-${id}`;
  await env.DB.prepare(
    "INSERT INTO identity_principal(id,issuer,subject,email,display_name,is_active,created_at,updated_at) VALUES(?,?,?,?,?,1,?,?)",
  )
    .bind(
      principalId,
      "savia:better-auth",
      subject,
      `member-${id}@example.test`,
      "SSO member",
      now,
      now,
    )
    .run();
  await env.DB.prepare(
    "INSERT INTO identity_tenant_membership(id,principal_id,tenant_id,role,is_active,created_at,updated_at) VALUES(?,?,?,'tenant_admin',1,?,?)",
  )
    .bind(`sso-membership-${id}`, principalId, id, now, now)
    .run();
  const platformPrincipalId = `sso-platform-principal-${id}`;
  const platformSubject = `sso-platform-subject-${id}`;
  await env.DB.prepare(
    "INSERT INTO identity_principal(id,issuer,subject,email,display_name,is_active,created_at,updated_at) VALUES(?,?,?,?,?,1,?,?)",
  )
    .bind(
      platformPrincipalId,
      "savia:better-auth",
      platformSubject,
      `platform-${id}@example.test`,
      "Platform member",
      now,
      now,
    )
    .run();
  await env.DB.prepare(
    "INSERT INTO identity_tenant_membership(id,principal_id,tenant_id,role,is_active,created_at,updated_at) VALUES(?,?,?,'tenant_admin',1,?,?)",
  )
    .bind(`sso-platform-membership-${id}`, platformPrincipalId, id, now, now)
    .run();
  await env.DB.prepare(
    "INSERT INTO identity_global_role(principal_id,role,created_at) VALUES(?,'platform_admin',?)",
  )
    .bind(platformPrincipalId, now)
    .run();
  return { id, subject, platformSubject };
}

function tenantAuthenticator(id: number, role = "tenant_admin"): Authenticator {
  return {
    async authenticate(request, database) {
      const actor = await platformAdministratorAuthenticator().authenticate(
        request,
        database,
      );
      return {
        ...actor,
        globalRoles: [],
        memberships: [
          {
            id: `membership-${id}`,
            principalId: actor.principal.id,
            agencyId: id,
            tenantId: id,
            role,
            isActive: true,
            createdAt: "",
            updatedAt: "",
          },
        ],
      };
    },
  };
}

function makeApp(id: number, role = "tenant_admin") {
  const calls: Array<{
    path: string;
    method: string;
    body?: any;
    bridgeKey?: string | null;
  }> = [];
  const bridge = {
    fetch: vi.fn(async (request: Request) => {
      const body =
        request.method === "GET" || request.method === "DELETE"
          ? undefined
          : await request.json();
      const path = new URL(request.url).pathname;
      calls.push({
        path,
        method: request.method,
        body,
        bridgeKey: request.headers.get("x-savia-bridge-key"),
      });
      if (path.startsWith("/_internal/users/"))
        return Response.json({ ok: true });
      if (request.method === "DELETE")
        return Response.json({ configured: false });
      const result = {
        configured: request.method === "PUT",
        displayName: "Example SAML",
        domain: "example.test",
        enabled: true,
        ssoOnly: false,
        providerId: "tenant-989001-a1b2c3",
        entityId:
          "https://auth.example.test/saml/service-provider/tenant-989001-a1b2c3",
        acsUrl:
          "https://auth.example.test/api/auth/sso/saml2/sp/tenant-989001-a1b2c3/acs",
        metadataUrl:
          "https://auth.example.test/api/auth/sso/saml2/sp/tenant-989001-a1b2c3/metadata",
        // IdP metadata is public configuration; unrelated fields remain private.
        privateKey: "must not be returned",
        idpMetadata: "<EntityDescriptor>public IdP metadata</EntityDescriptor>",
      };
      return Response.json(result);
    }),
  };
  const app = new OpenAPIHono();
  app.use(
    "/v1/*",
    authenticationMiddleware(env.DB, tenantAuthenticator(id, role)),
  );
  registerTenantSSORoutes(app, env.DB, bridge, "test-bridge-key");
  return { app, calls, bridge };
}

const validInput = {
  displayName: "Example SAML",
  domain: "example.test",
  idpMetadata:
    '<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata"/>',
  enabled: true,
  ssoOnly: false,
};

it("proxies admin SSO settings, forwards the actor and exposes only safe configuration", async () => {
  const tenant = await createTenant();
  const { app, calls } = makeApp(tenant.id);
  const path = `https://api.test/v1/tenants/${tenant.id}/sso-settings`;
  const get = await app.request(path);
  expect(get.status).toBe(200);
  expect(get.headers.get("cache-control")).toBe("no-store");
  expect(await get.json()).toMatchObject({
    idpMetadata: "<EntityDescriptor>public IdP metadata</EntityDescriptor>",
  });

  const save = await app.request(path, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(validInput),
  });
  expect(save.status).toBe(200);
  expect(save.headers.get("cache-control")).toBe("no-store");
  const result = await save.json();
  expect(result).toMatchObject({ configured: true, domain: "example.test" });
  expect(result).toHaveProperty("idpMetadata");
  expect(result).not.toHaveProperty("privateKey");
  const saveCall = calls.find(
    ({ path: target, method }) =>
      target === `/_internal/tenant-sso/${tenant.id}` && method === "PUT",
  );
  expect(saveCall).toMatchObject({
    bridgeKey: "test-bridge-key",
    body: { ...validInput, actorSubject: expect.any(String) },
  });
  expect(saveCall?.body.actorSubject).not.toBe(tenant.subject);
  const memberSyncs = calls.filter(
    ({ path: target, method }) =>
      target.startsWith("/_internal/users/") && method === "PATCH",
  );
  expect(memberSyncs).toHaveLength(1);
  expect(memberSyncs[0].path).not.toBe(
    `/_internal/users/${tenant.platformSubject}`,
  );
  expect(memberSyncs[0]).toMatchObject({
    path: `/_internal/users/${tenant.subject}`,
    body: { tenantId: tenant.id },
    bridgeKey: "test-bridge-key",
  });
  expect(calls.indexOf(memberSyncs[0])).toBeLessThan(calls.indexOf(saveCall!));

  const remove = await app.request(path, { method: "DELETE" });
  expect(remove.status).toBe(200);
  expect(await remove.json()).toEqual({ configured: false });
});

it("rejects cross-tenant and non-admin access before contacting auth", async () => {
  const tenant = await createTenant();
  const otherTenant = await createTenant();
  const crossTenant = makeApp(otherTenant.id);
  const path = `https://api.test/v1/tenants/${tenant.id}/sso-settings`;
  expect((await crossTenant.app.request(path)).status).toBe(403);
  expect(crossTenant.bridge.fetch).not.toHaveBeenCalled();

  const member = makeApp(tenant.id, "viewer");
  expect((await member.app.request(path)).status).toBe(403);
  expect(member.bridge.fetch).not.toHaveBeenCalled();
});

it("validates SAML settings before forwarding the request", async () => {
  const tenant = await createTenant();
  const { app, bridge } = makeApp(tenant.id);
  const path = `https://api.test/v1/tenants/${tenant.id}/sso-settings`;
  const invalid = [
    { ...validInput, domain: "Example.test" },
    { ...validInput, domain: "example..test" },
    { ...validInput, idpMetadata: "<metadata/>" },
    {
      ...validInput,
      idpMetadata: `<EntityDescriptor>${"x".repeat(102_400)}</EntityDescriptor>`,
    },
    { ...validInput, extra: "unexpected" },
  ];
  for (const body of invalid) {
    const response = await app.request(path, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(response.status).toBe(400);
  }
  expect(bridge.fetch).not.toHaveBeenCalled();
});

it("forwards tenant SSO activity changes through the authenticated bridge", async () => {
  const tenant = await createTenant();
  const fetch = vi.fn(async (request: Request) => {
    expect(request.method).toBe("PATCH");
    expect(new URL(request.url).pathname).toBe(
      `/_internal/tenant-sso/${tenant.id}/activity`,
    );
    expect(request.headers.get("x-savia-bridge-key")).toBe("bridge-key");
    expect(await request.json()).toEqual({ active: false });
    return Response.json({ ok: true });
  });

  await setTenantSSOActivity({ fetch }, "bridge-key", tenant.id, false);

  expect(fetch).toHaveBeenCalledOnce();
});

it("disables SSO before tenant deactivation and enables it after activation", async () => {
  const tenant = await createTenant();
  const app = new OpenAPIHono();
  app.use(
    "/v1/*",
    authenticationMiddleware(env.DB, platformAdministratorAuthenticator()),
  );
  const activityCalls: Array<{
    id: number;
    active: boolean;
    tenantActive: number;
  }> = [];
  registerTenantRoutes(
    app,
    env.DB,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    async (id, active) => {
      const row = await env.DB.prepare(
        "SELECT is_active FROM tenants WHERE id=?",
      )
        .bind(id)
        .first<{ is_active: number }>();
      activityCalls.push({ id, active, tenantActive: row!.is_active });
    },
  );

  const path = `https://api.test/v1/tenants/${tenant.id}`;
  expect(
    (
      await app.request(path, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ isActive: false }),
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await app.request(path, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ isActive: true }),
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await app.request(path, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ isActive: true }),
      })
    ).status,
  ).toBe(200);
  expect(activityCalls).toEqual([
    { id: tenant.id, active: false, tenantActive: 1 },
    { id: tenant.id, active: true, tenantActive: 1 },
  ]);
});

it("fails closed when SSO cannot be disabled before tenant deactivation", async () => {
  const tenant = await createTenant();
  const app = new OpenAPIHono();
  app.use(
    "/v1/*",
    authenticationMiddleware(env.DB, platformAdministratorAuthenticator()),
  );
  registerTenantRoutes(
    app,
    env.DB,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    async () => {
      throw new Error("auth bridge unavailable");
    },
  );

  const response = await app.request(
    `https://api.test/v1/tenants/${tenant.id}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ isActive: false }),
    },
  );
  const row = await env.DB.prepare("SELECT is_active FROM tenants WHERE id=?")
    .bind(tenant.id)
    .first<{ is_active: number }>();

  expect(response.status).toBe(500);
  expect(row?.is_active).toBe(1);
});

it("does not disable SSO when tenant slug validation prevents deactivation", async () => {
  const tenant = await createTenant();
  const otherTenant = await createTenant();
  const app = new OpenAPIHono();
  app.use(
    "/v1/*",
    authenticationMiddleware(env.DB, platformAdministratorAuthenticator()),
  );
  const activity = vi.fn(async () => {});
  registerTenantRoutes(
    app,
    env.DB,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    activity,
  );

  const response = await app.request(
    `https://api.test/v1/tenants/${tenant.id}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        isActive: false,
        idSlug: `sso-${otherTenant.id}`,
      }),
    },
  );

  expect(response.status).toBe(409);
  expect(activity).not.toHaveBeenCalled();
});

it("rolls back tenant activation if SSO cannot be reenabled so activation can be retried", async () => {
  const tenant = await createTenant();
  await env.DB.prepare("UPDATE tenants SET is_active=0 WHERE id=?")
    .bind(tenant.id)
    .run();
  const app = new OpenAPIHono();
  app.use(
    "/v1/*",
    authenticationMiddleware(env.DB, platformAdministratorAuthenticator()),
  );
  const activity = vi
    .fn<(id: number, active: boolean) => Promise<void>>()
    .mockRejectedValueOnce(new Error("auth bridge unavailable"))
    .mockResolvedValueOnce(undefined);
  registerTenantRoutes(
    app,
    env.DB,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    activity,
  );
  const path = `https://api.test/v1/tenants/${tenant.id}`;
  const request = () =>
    app.request(path, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ isActive: true }),
    });

  expect((await request()).status).toBe(500);
  expect(
    (
      await env.DB.prepare("SELECT is_active FROM tenants WHERE id=?")
        .bind(tenant.id)
        .first<{ is_active: number }>()
    )?.is_active,
  ).toBe(0);
  expect((await request()).status).toBe(200);
  expect(activity).toHaveBeenCalledTimes(2);
});
