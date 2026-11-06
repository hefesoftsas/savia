import { env } from "cloudflare:workers";
import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeAll, expect, it } from "vitest";
import { authenticationMiddleware } from "../src/auth/middleware";
import { upsertPrincipal } from "../src/auth/identity-repository";
import type { AppActor } from "../src/auth/types";
import { registerWhatsappAssistantRoutes } from "../src/whatsapp/assistant-routes";
import { createWhatsappRepository } from "../src/whatsapp/repository";
import { VirtualEmployeesRepository } from "../src/assistant/virtual-employees";

beforeAll(async () => {
  const migrations = Object.entries(
    import.meta.glob<string>("../../../packages/db/migrations/*.sql", {
      eager: true,
      import: "default",
      query: "?raw",
    }),
  ).sort(([a], [b]) => a.localeCompare(b));
  for (const [, sql] of migrations)
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

let counter = 985000;
async function setup() {
  const tenantId = ++counter;
  await env.DB.prepare(
    "INSERT INTO tenants(id,id_slug,name,is_active,created_at,updated_at) VALUES(?,?,?,1,?,?)",
  )
    .bind(
      tenantId,
      `wa-assistant-${tenantId}`,
      "Test tenant",
      "2026-10-05",
      "2026-10-05",
    )
    .run();
  const principal = await upsertPrincipal(env.DB, {
    issuer: "test",
    subject: `wa-assistant-${tenantId}`,
    email: `${tenantId}@example.test`,
    displayName: "Owner",
  });
  await env.DB.prepare(
    "INSERT INTO identity_tenant_membership(id,principal_id,tenant_id,role,is_active,created_at,updated_at) VALUES(?,?,?,'tenant_admin',1,?,?)",
  )
    .bind(`m-${tenantId}`, principal.id, tenantId, "2026-10-05", "2026-10-05")
    .run();
  const actor: AppActor = {
    principal,
    globalRoles: [],
    memberships: [
      {
        id: `m-${tenantId}`,
        principalId: principal.id,
        agencyId: tenantId,
        tenantId,
        role: "tenant_admin",
        isActive: true,
        createdAt: "",
        updatedAt: "",
      },
    ],
  };
  await createWhatsappRepository(env.DB).saveConnection({
    agencyId: tenantId,
    actor,
    nangoConnectionId: `nango-${tenantId}`,
    nangoIntegrationId: "whatsapp-business",
    status: "connected",
    phoneNumberId: "123456789",
    wabaId: "987654321",
  });
  const employee = await new VirtualEmployeesRepository(env.DB).create({
    agencyId: tenantId,
    name: "Support",
    handle: "support",
    systemPrompt: "Answer customers",
    allowedCollections: [],
  });
  function app(override: AppActor = actor, ready = true) {
    const a = new OpenAPIHono();
    a.use(
      "*",
      authenticationMiddleware(env.DB, { authenticate: async () => override }),
    );
    registerWhatsappAssistantRoutes(a, env.DB, ready);
    return a;
  }
  const input = {
    agencyId: tenantId,
    employeeId: employee.id,
    enabled: true,
    allowedContacts: ["+57 300 1234567"],
  };
  return { app, input, actor, tenantId };
}
function put(app: OpenAPIHono, input: unknown) {
  return app.request("/v1/whatsapp/assistant", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
}

it("persists a tenant-specific employee and normalizes readable pilot contacts", async () => {
  const s = await setup();
  expect((await put(s.app(), s.input)).status).toBe(200);
  const response = await s
    .app()
    .request(`/v1/whatsapp/assistant?agencyId=${s.tenantId}`);
  expect((await response.json()).data.settings).toMatchObject({
    tenantId: s.tenantId,
    employeeId: s.input.employeeId,
    allowedContacts: ["573001234567"],
    enabled: true,
  });
});

it("rejects an employee belonging to another tenant", async () => {
  const s = await setup(),
    other = await setup();
  expect(
    (await put(s.app(), { ...s.input, employeeId: other.input.employeeId }))
      .status,
  ).toBe(422);
});

it("does not let viewers or admins from another tenant manage the binding", async () => {
  const s = await setup();
  for (const memberships of [
    s.actor.memberships.map((m) => ({ ...m, role: "viewer" })),
    s.actor.memberships.map((m) => ({
      ...m,
      tenantId: s.tenantId + 100,
      agencyId: s.tenantId + 100,
    })),
  ]) {
    const app = s.app({ ...s.actor, memberships });
    expect((await put(app, s.input)).status).toBe(403);
    expect(
      (await app.request(`/v1/whatsapp/assistant?agencyId=${s.tenantId}`))
        .status,
    ).toBe(403);
  }
});

it("cannot enable replies without webhook readiness or allowed contacts", async () => {
  const s = await setup();
  expect((await put(s.app(s.actor, false), s.input)).status).toBe(503);
  expect((await put(s.app(), { ...s.input, allowedContacts: [] })).status).toBe(
    400,
  );
});

it("lets a tenant admin disable replies while webhook setup is unavailable", async () => {
  const s = await setup();
  expect(
    (
      await put(s.app(s.actor, false), {
        ...s.input,
        enabled: false,
        allowedContacts: [],
      })
    ).status,
  ).toBe(200);
});

it("lets an admin disable replies after the sender disconnects and the employee becomes inactive", async () => {
  const s = await setup();
  expect((await put(s.app(), s.input)).status).toBe(200);
  await env.DB.prepare(
    "UPDATE tenant_whatsapp_connections SET disconnected_at = ? WHERE tenant_id = ?",
  )
    .bind(new Date().toISOString(), s.tenantId)
    .run();
  await env.DB.prepare(
    "UPDATE assistant_virtual_employees SET status = 'inactive' WHERE id = ?",
  )
    .bind(s.input.employeeId)
    .run();
  expect((await put(s.app(), { ...s.input, enabled: false })).status).toBe(200);
});
