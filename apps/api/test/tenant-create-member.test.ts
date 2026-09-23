import { createTestApp } from "./test-app";
import { env } from "cloudflare:workers";
import { beforeAll, expect, it } from "vitest";
import { platformAdministratorAuthenticator } from "./auth-fixtures";
import {
  ensureBootstrapAdministrator,
  grantMembership,
  setPrincipalActive,
  upsertPrincipal,
} from "../src/auth/identity-repository";
const migrations = Object.entries(
  import.meta.glob<string>("../../../packages/db/migrations/*.sql", {
    eager: true,
    import: "default",
    query: "?raw",
  }),
)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([, s]) => s);
beforeAll(async () => {
  for (const sql of migrations)
    for (const statement of sql
      .split("--> statement-breakpoint")
      .map((s) =>
        s
          .replace(/^--.*$/gm, "")
          .replace(/\s+/g, " ")
          .trim(),
      )
      .filter(Boolean))
      await env.DB.exec(statement);
});
let counter = 980000;
async function tenant(name = "Source agency") {
  // Wide spacing: tenant creation allocates MAX(id)+2, so sequential IDs
  // would collide with tenants created by the API under test.
  counter += 1000;
  const id = counter,
    slug = "transfer-" + id,
    now = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO tenants(id,id_slug,name,is_active,created_at,updated_at,kind) VALUES(?,?,?,1,?,?,'commercial')",
  )
    .bind(id, slug, name, now, now)
    .run();
  return { id, slug };
}
async function member(
  email: string,
  tenantId: number,
  role: "tenant_admin" | "operator" | "viewer" = "operator",
) {
  const principal = await upsertPrincipal(env.DB, {
    issuer: "savia:better-auth",
    subject: email,
    email,
    displayName: email,
  });
  await grantMembership(env.DB, principal.id, tenantId, role);
  return principal;
}
function app() {
  // No user administrator on purpose: transferring an existing member must
  // not depend on the Better Auth service.
  return createTestApp({ auth: platformAdministratorAuthenticator() });
}
const post = (body: unknown) => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});
async function tenantByName(name: string) {
  return env.DB.prepare("SELECT id FROM tenants WHERE name=?")
    .bind(name)
    .first<{ id: number }>();
}
async function membershipOf(principalId: string) {
  return env.DB.prepare(
    "SELECT tenant_id,role FROM identity_tenant_membership WHERE principal_id=?",
  )
    .bind(principalId)
    .first<{ tenant_id: number; role: string }>();
}
it("transfers an existing user as first member and keeps the source tenant", async () => {
  const source = await tenant(),
    staying = await member("stays@example.test", source.id, "tenant_admin"),
    moving = await member("moves@example.test", source.id, "operator");
  const response = await app().request(
    "/v1/tenants",
    post({
      name: "Destination agency",
      existingMember: { principalId: moving.id, role: "tenant_admin" },
    }),
  );
  expect(response.status).toBe(201);
  const created = ((await response.json()) as any).data;
  expect(created.name).toBe("Destination agency");
  expect(await membershipOf(moving.id)).toEqual({
    tenant_id: created.id,
    role: "tenant_admin",
  });
  expect(await membershipOf(staying.id)).toEqual({
    tenant_id: source.id,
    role: "tenant_admin",
  });
});
it("rejects unknown or inactive principals without creating a tenant", async () => {
  const unknown = await app().request(
    "/v1/tenants",
    post({
      name: "Nowhere agency",
      existingMember: { principalId: crypto.randomUUID(), role: "viewer" },
    }),
  );
  expect(unknown.status).toBe(404);
  expect(await unknown.json()).toEqual({
    error: { code: "USER_NOT_FOUND", message: "El usuario no existe." },
  });
  const ghost = await upsertPrincipal(env.DB, {
    issuer: "savia:better-auth",
    subject: "ghost@example.test",
    email: "ghost@example.test",
    displayName: "Ghost",
  });
  await setPrincipalActive(env.DB, ghost.id, false);
  const inactive = await app().request(
    "/v1/tenants",
    post({
      name: "Ghost agency",
      existingMember: { principalId: ghost.id, role: "viewer" },
    }),
  );
  expect(inactive.status).toBe(404);
  expect(await tenantByName("Nowhere agency")).toBe(null);
  expect(await tenantByName("Ghost agency")).toBe(null);
});
it("rejects platform administrators without touching tenants", async () => {
  const source = await tenant();
  await member("admin-source@example.test", source.id, "tenant_admin");
  const principal = await upsertPrincipal(env.DB, {
    issuer: "savia:better-auth",
    subject: "super@example.test",
    email: "super@example.test",
    displayName: "Super",
  });
  await ensureBootstrapAdministrator(env.DB, principal.id);
  const response = await app().request(
    "/v1/tenants",
    post({
      name: "Super agency",
      existingMember: { principalId: principal.id, role: "tenant_admin" },
    }),
  );
  expect(response.status).toBe(409);
  expect(await tenantByName("Super agency")).toBe(null);
  expect(await membershipOf(principal.id)).toEqual({
    tenant_id: 0,
    role: "tenant_admin",
  });
});
it("rejects transferring the last active member and compensates the tenant row", async () => {
  const source = await tenant(),
    only = await member("only@example.test", source.id, "tenant_admin");
  const response = await app().request(
    "/v1/tenants",
    post({
      name: "Lonely agency",
      existingMember: { principalId: only.id, role: "tenant_admin" },
    }),
  );
  expect(response.status).toBe(409);
  expect(await tenantByName("Lonely agency")).toBe(null);
  expect(await membershipOf(only.id)).toEqual({
    tenant_id: source.id,
    role: "tenant_admin",
  });
});
it("requires exactly one member source", async () => {
  const source = await tenant(),
    person = await member("either@example.test", source.id);
  const neither = await app().request(
    "/v1/tenants",
    post({ name: "Neither agency" }),
  );
  expect(neither.status).toBe(400);
  const both = await app().request(
    "/v1/tenants",
    post({
      name: "Both agency",
      initialUser: {
        email: "new@example.test",
        firstName: "New",
        lastName: "User",
        role: "tenant_admin",
      },
      existingMember: { principalId: person.id, role: "viewer" },
    }),
  );
  expect(both.status).toBe(400);
  expect(await tenantByName("Neither agency")).toBe(null);
  expect(await tenantByName("Both agency")).toBe(null);
});
