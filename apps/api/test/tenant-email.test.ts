import { env } from "cloudflare:workers";
import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeAll, expect, it, vi } from "vitest";
import { authenticationMiddleware } from "../src/auth/middleware";
import type { Authenticator } from "../src/auth/types";
import { registerTenantEmailRoutes } from "../src/tenant-email/routes";
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

let nextId = 988000;
async function createTenant() {
  const id = ++nextId;
  const now = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO tenants(id,id_slug,name,is_active,created_at,updated_at) VALUES(?,?,?,1,?,?)",
  )
    .bind(id, `email-${id}`, "Email tenant", now, now)
    .run();
  const principalId = `email-test-principal-${id}`;
  await env.DB.prepare(
    "INSERT INTO identity_principal(id,issuer,subject,email,display_name,is_active,created_at,updated_at) VALUES(?,?,?,?,?,1,?,?)",
  )
    .bind(
      principalId,
      "savia:better-auth",
      `email-subject-${id}`,
      `member-${id}@example.test`,
      "Email member",
      now,
      now,
    )
    .run();
  await env.DB.prepare(
    "INSERT INTO identity_tenant_membership(id,principal_id,tenant_id,role,is_active,created_at,updated_at) VALUES(?,?,?,'tenant_admin',1,?,?)",
  )
    .bind(`email-membership-${id}`, principalId, id, now, now)
    .run();
  return {
    id,
    principalId,
    subject: `email-subject-${id}`,
    email: `member-${id}@example.test`,
  };
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
      calls.push({
        path: new URL(request.url).pathname,
        method: request.method,
        body,
        bridgeKey: request.headers.get("x-savia-bridge-key"),
      });
      if (new URL(request.url).pathname.endsWith("/test"))
        return Response.json({ sent: true });
      if (request.method === "DELETE")
        return Response.json({ configured: false });
      if (request.method === "PUT")
        return Response.json({ configured: true, passwordConfigured: true });
      return Response.json({ configured: false });
    }),
  };
  const app = new OpenAPIHono();
  app.use(
    "/v1/*",
    authenticationMiddleware(env.DB, tenantAuthenticator(id, role)),
  );
  registerTenantEmailRoutes(app, env.DB, bridge, "test-bridge-key");
  return { app, calls, bridge };
}

it("authorizes tenant admins, redacts saved secrets, and syncs existing account tenant assignments", async () => {
  const tenant = await createTenant();
  const { app, calls } = makeApp(tenant.id);
  const path = `https://api.test/v1/tenants/${tenant.id}/email-settings`;
  const get = await app.request(path);
  expect(get.status).toBe(200);
  expect(get.headers.get("cache-control")).toBe("no-store");
  expect(await get.json()).toEqual({ configured: false });
  const save = await app.request(path, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      host: "smtp.example.test",
      port: 587,
      security: "starttls",
      username: "relay",
      password: "secret",
      from: "mail@example.test",
    }),
  });
  expect(save.status).toBe(200);
  expect(
    calls.some(
      ({ path: target, method, body, bridgeKey }) =>
        target === `/_internal/users/${tenant.subject}` &&
        method === "PATCH" &&
        body.tenantId === tenant.id &&
        bridgeKey === "test-bridge-key",
    ),
  ).toBe(true);
  expect(
    calls.some(
      ({ path: target, method, body }) =>
        target.startsWith("/_internal/tenant-email/") &&
        method === "PUT" &&
        body.password === "secret",
    ),
  ).toBe(true);
  const test = await app.request(`${path}/test`, { method: "POST" });
  expect(test.status).toBe(200);
  expect(
    calls.find(
      ({ path: target, method }) =>
        target.endsWith("/test") && method === "POST",
    )?.body.actorEmail,
  ).toBeTruthy();
  expect((await app.request(path, { method: "DELETE" })).status).toBe(200);
});

it("denies non-admin tenant members even for redacted reads", async () => {
  const tenant = await createTenant();
  const { app, bridge } = makeApp(tenant.id, "viewer");
  const response = await app.request(
    `https://api.test/v1/tenants/${tenant.id}/email-settings`,
  );
  expect(response.status).toBe(403);
  expect(bridge.fetch).not.toHaveBeenCalled();
});
