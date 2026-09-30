import { env } from "cloudflare:workers";
import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeAll, expect, it, vi } from "vitest";
import { authenticationMiddleware } from "../src/auth/middleware";
import type { Authenticator } from "../src/auth/types";
import {
  deleteTenantSocialSettings,
  registerTenantSocialRoutes,
  setTenantSocialActivity,
} from "../src/tenant-social/routes";
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

let nextId = 990000;
async function createTenant() {
  const id = ++nextId;
  const now = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO tenants(id,id_slug,name,is_active,created_at,updated_at) VALUES(?,?,?,1,?,?)",
  )
    .bind(id, `social-${id}`, "Social tenant", now, now)
    .run();
  const principalId = `social-principal-${id}`;
  const subject = `social-subject-${id}`;
  await env.DB.prepare(
    "INSERT INTO identity_principal(id,issuer,subject,email,display_name,is_active,created_at,updated_at) VALUES(?,?,?,?,?,1,?,?)",
  )
    .bind(
      principalId,
      "savia:better-auth",
      subject,
      `member-${id}@example.test`,
      "Social member",
      now,
      now,
    )
    .run();
  await env.DB.prepare(
    "INSERT INTO identity_tenant_membership(id,principal_id,tenant_id,role,is_active,created_at,updated_at) VALUES(?,?,?,'tenant_admin',1,?,?)",
  )
    .bind(`social-membership-${id}`, principalId, id, now, now)
    .run();
  const platformPrincipalId = `social-platform-principal-${id}`;
  const platformSubject = `social-platform-subject-${id}`;
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
    .bind(`social-platform-membership-${id}`, platformPrincipalId, id, now, now)
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

const unavailableSettings = {
  configured: false,
  googleEnabled: false,
  microsoftEnabled: false,
  microsoftTenantId: "",
  googleAvailable: false,
  microsoftAvailable: false,
  googleCallbackUrl: "https://auth.example.test/api/auth/callback/google",
  microsoftCallbackUrl: "https://auth.example.test/api/auth/callback/microsoft",
};

const validInput = {
  googleEnabled: true,
  microsoftEnabled: true,
  microsoftTenantId: "123e4567-e89b-12d3-a456-426614174000",
};

function makeApp(
  id: number,
  role = "tenant_admin",
  bridgeReply?: (request: Request) => Promise<Response>,
) {
  const calls: Array<{
    path: string;
    method: string;
    body?: unknown;
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
      if (bridgeReply) return bridgeReply(request);
      if (path.startsWith("/_internal/users/"))
        return Response.json({ ok: true });
      return Response.json(unavailableSettings);
    }),
  };
  const app = new OpenAPIHono();
  app.use(
    "/v1/*",
    authenticationMiddleware(env.DB, tenantAuthenticator(id, role)),
  );
  registerTenantSocialRoutes(app, env.DB, bridge, "test-social-bridge-key");
  return { app, calls, bridge };
}

it("proxies safe settings without caching and synchronizes active tenant members before saving", async () => {
  const tenant = await createTenant();
  const { app, calls } = makeApp(tenant.id, "tenant_admin", async (request) => {
    if (new URL(request.url).pathname.startsWith("/_internal/users/"))
      return Response.json({ ok: true });
    if (request.method === "PUT")
      return Response.json({
        ...unavailableSettings,
        configured: true,
        googleEnabled: true,
        microsoftEnabled: true,
        microsoftTenantId: validInput.microsoftTenantId,
        googleAvailable: true,
        microsoftAvailable: true,
      });
    if (request.method === "DELETE") return Response.json(unavailableSettings);
    return Response.json(unavailableSettings);
  });
  const path = `https://api.test/v1/tenants/${tenant.id}/social-settings`;
  const get = await app.request(path);
  expect(get.status).toBe(200);
  expect(get.headers.get("cache-control")).toBe("no-store");
  expect(await get.json()).toEqual(unavailableSettings);

  const save = await app.request(path, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(validInput),
  });
  expect(save.status).toBe(200);
  expect(save.headers.get("cache-control")).toBe("no-store");
  expect(await save.json()).toMatchObject({
    configured: true,
    googleEnabled: true,
    microsoftEnabled: true,
  });
  const saved = calls.find(
    ({ path: target, method }) =>
      target === `/_internal/tenant-social/${tenant.id}` && method === "PUT",
  );
  expect(saved).toMatchObject({
    bridgeKey: "test-social-bridge-key",
    body: { ...validInput, actorSubject: expect.any(String) },
  });
  expect(saved?.body).toHaveProperty("actorSubject");
  expect(
    calls.some(
      ({ path: target, method }) =>
        target === `/_internal/users/${tenant.subject}` && method === "PATCH",
    ),
  ).toBe(true);
  expect(
    calls.some(
      ({ path: target }) =>
        target === `/_internal/users/${tenant.platformSubject}`,
    ),
  ).toBe(false);

  const remove = await app.request(path, { method: "DELETE" });
  expect(remove.status).toBe(200);
  expect(remove.headers.get("cache-control")).toBe("no-store");
  expect(await remove.json()).toEqual(unavailableSettings);
});

it("rejects cross-tenant and non-admin access before contacting auth", async () => {
  const tenant = await createTenant();
  const other = await createTenant();
  const path = `https://api.test/v1/tenants/${tenant.id}/social-settings`;
  const crossTenant = makeApp(other.id);
  expect((await crossTenant.app.request(path)).status).toBe(403);
  expect(crossTenant.bridge.fetch).not.toHaveBeenCalled();
  const member = makeApp(tenant.id, "viewer");
  expect((await member.app.request(path)).status).toBe(403);
  expect(member.bridge.fetch).not.toHaveBeenCalled();
});

it("validates provider settings and returns provider-unavailable errors from auth", async () => {
  const tenant = await createTenant();
  const { app, bridge } = makeApp(
    tenant.id,
    "tenant_admin",
    async (request) => {
      if (new URL(request.url).pathname.startsWith("/_internal/users/"))
        return Response.json({ ok: true });
      return Response.json(
        { error: "Google sign-in is unavailable in this deployment." },
        { status: 409 },
      );
    },
  );
  const path = `https://api.test/v1/tenants/${tenant.id}/social-settings`;
  for (const body of [
    { ...validInput, microsoftTenantId: "" },
    { ...validInput, microsoftTenantId: "not-a-guid" },
    { ...validInput, extra: true },
  ]) {
    const response = await app.request(path, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(response.status).toBe(400);
  }
  expect(bridge.fetch).not.toHaveBeenCalled();
  const unavailable = await app.request(path, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(validInput),
  });
  expect(unavailable.status).toBe(409);
  expect(await unavailable.text()).toBe(
    "Google sign-in is unavailable in this deployment.",
  );
});

it("exports authenticated delete and activity bridge helpers", async () => {
  const fetch = vi.fn(async (request: Request) => {
    const path = new URL(request.url).pathname;
    if (path.endsWith("/activity")) {
      expect(request.method).toBe("PATCH");
      expect(await request.json()).toEqual({ active: false });
    } else {
      expect(request.method).toBe("DELETE");
    }
    expect(request.headers.get("x-savia-bridge-key")).toBe("bridge-key");
    return Response.json(unavailableSettings);
  });
  await deleteTenantSocialSettings({ fetch }, "bridge-key", 987);
  await setTenantSocialActivity({ fetch }, "bridge-key", 987, false);
  expect(fetch).toHaveBeenCalledTimes(2);
});
