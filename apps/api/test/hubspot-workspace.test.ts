import { env } from "cloudflare:workers";
import { beforeAll, expect, it, vi } from "vitest";
import {
  createHubspotWorkspaceApp,
  capabilities,
} from "../src/crm/hubspot-workspace";
import { createCollectionSourceApp } from "../src/crm/collection-sources";
let conn: any = {
  id: "connection",
  status: "connected",
  externalAccountId: "123",
  externalAccountLabel: "Test",
  scopes: ["crm.objects.contacts.write", "crm.objects.companies.write"],
};
vi.mock("../src/crm/repository", () => ({
  createCrmRepository: () => ({
    findActiveConnectionForPrincipal: async (_: string, principal: string) =>
      principal === "owner"
        ? conn
        : principal === "member"
          ? { ...conn, id: "unrelated-connection", externalAccountId: "456" }
          : undefined,
  }),
}));
const calls: any[] = [];
const context: any = {
  db: env.DB,
  files: env.FILES,
  tenant: "domain:workspace-test",
  actor: {
    principal: { id: "owner", isActive: true },
    globalRoles: ["platform_admin"],
    memberships: [],
  },
  seedObjects: [],
  crm: {
    nango: {
      proxy: async (request: any) => {
        calls.push(request);
        const path = request.path;
        if (path.includes("/properties/"))
          return Response.json({
            results: [
              { name: "firstname", type: "string" },
              {
                name: "lastname",
                type: "string",
                modificationMetadata: { readOnlyValue: true },
              },
              { name: "name", type: "string" },
            ],
          });
        if (path.endsWith("/labels"))
          return Response.json({
            results: [{ label: null, category: "HUBSPOT_DEFINED", typeId: 1 }],
          });
        if (path.includes("/associations/"))
          return request.method === "GET"
            ? Response.json({ results: [{ id: "9" }] })
            : new Response(null, { status: 204 });
        if (path.includes("/batch/read"))
          return Response.json({
            results: [{ id: "9", properties: { name: "Acme" } }],
          });
        if (!path.includes("/contacts") && !path.includes("/companies"))
          return new Response(null, { status: 403 });
        if (request.method === "DELETE")
          return new Response(null, { status: 204 });
        if (request.method === "POST" && !path.endsWith("/search"))
          return Response.json({
            id: "8",
            properties: request.body.properties,
          });
        if (request.method === "PATCH")
          return Response.json({
            id: "7",
            properties: request.body.properties,
          });
        if (/\/7\?/.test(path) || path.endsWith("/7"))
          return Response.json({ id: "7", properties: { firstname: "Ada" } });
        return Response.json({
          results: [
            { id: "7", properties: { firstname: "Ada", name: "Acme" } },
          ],
          ...(path.includes("after=")
            ? {}
            : { paging: { next: { after: "7" } } }),
        });
      },
    },
  },
};
beforeAll(async () => {
  for (const [, sql] of Object.entries(
    import.meta.glob<string>("../../../packages/db/migrations/*.sql", {
      eager: true,
      import: "default",
      query: "?raw",
    }),
  ).sort(([a], [b]) => a.localeCompare(b)))
    for (const part of sql.split("--> statement-breakpoint")) {
      const statement = part
        .replace(/^--.*$/gm, "")
        .replace(/\s+/g, " ")
        .trim();
      if (statement) await env.DB.exec(statement);
    }
});
const request = (path: string, method = "GET", body?: any) =>
  createHubspotWorkspaceApp(context).request(path, {
    method,
    ...(body
      ? {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
  });
it("installs permitted objects idempotently, with actual scope capabilities", async () => {
  expect(capabilities([], "contacts").create).toBe(false);
  const response = await request("/api/crm-workspace/install", "POST", {});
  expect(await response.clone().text()).not.toContain("error");
  expect(response.status).toBe(200);
  const data = ((await response.json()) as any).data;
  expect(data.objects.map((x: any) => x.name)).toEqual([
    "hubspot_contacts",
    "hubspot_companies",
  ]);
  expect(data.unavailable).toHaveLength(10);
  expect((await request("/api/crm-workspace/install", "POST", {})).status).toBe(
    200,
  );
});
it("reads remote pages and rejects invalid fields before writes", async () => {
  const response = await request(
    "/api/records/hubspot_contacts?page=2&perPage=1",
  );
  expect(response.status).toBe(200);
  expect(calls.at(-1).path).toContain("after=7");
  const count = calls.length;
  expect(
    (
      await request("/api/records/hubspot_contacts/7", "PATCH", {
        lastname: "readonly",
      })
    ).status,
  ).toBe(422);
  expect(calls).toHaveLength(count);
  expect(
    (
      await request("/api/records/hubspot_contacts/7", "PATCH", {
        firstname: "Grace",
      })
    ).status,
  ).toBe(200);
  expect(calls.at(-1).body).toEqual({ properties: { firstname: "Grace" } });
  expect(
    (await request("/api/records/hubspot_contacts/7", "DELETE")).status,
  ).toBe(200);
});
it("enforces principal, tenant, active connection, account and current grants", async () => {
  const foreign = {
    ...context,
    actor: {
      principal: { id: "other", isActive: true },
      globalRoles: [],
      memberships: [],
    },
  };
  expect(
    (
      await createHubspotWorkspaceApp(foreign).request(
        "/api/records/hubspot_contacts",
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await createHubspotWorkspaceApp({ ...context, tenant: "other" }).request(
        "/api/records/hubspot_contacts",
      )
    ).status,
  ).toBe(404);
  const before = conn;
  conn = { ...before, id: "other" };
  expect((await request("/api/records/hubspot_contacts")).status).toBe(403);
  conn = { ...before, externalAccountId: "456" };
  expect((await request("/api/records/hubspot_contacts")).status).toBe(403);
  conn = { ...before, scopes: [] };
  expect(
    (
      await request("/api/records/hubspot_contacts/7", "PATCH", {
        firstname: "x",
      })
    ).status,
  ).toBe(405);
  conn = before;
});
it("resolves native links and performs safe provider association mutations", async () => {
  const response = await request("/api/record-links/hubspot_contacts/7");
  expect(response.status).toBe(200);
  const data = ((await response.json()) as any).data;
  expect(
    data.find((x: any) => x.targetObject === "hubspot_companies").records,
  ).toEqual([{ id: "9", label: "Acme" }]);
  const link = await request(
    "/api/record-links/hubspot_contacts/7/hubspot%3Ahubspot_contacts%3Ahubspot_companies",
    "POST",
    { targetId: "9" },
  );
  expect(link.status).toBe(200);
  expect(calls.at(-1).path).toBe(
    "/crm/v4/objects/contacts/7/associations/default/companies/9",
  );
  expect(calls.at(-1).body).toEqual({});
});
it("keeps bound field contracts immutable through generic metadata routes", async () => {
  const app = createCollectionSourceApp(
    env.DB,
    env.FILES,
    context.tenant,
    "owner",
  );
  const object = (
    (await (await app.request("/api/objects/hubspot_contacts")).json()) as any
  ).data;
  object.config.fields.firstname.readOnly = true;
  expect(
    (
      await app.request("/api/objects/hubspot_contacts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(object),
      })
    ).status,
  ).toBe(422);
});

it("reconciles provider fields without losing screen and field labels", async () => {
  const row = await env.DB.prepare(
    "SELECT config FROM crm_objects WHERE tenant_id=? AND name=?",
  )
    .bind(context.tenant, "hubspot_contacts")
    .first<{ config: string }>();
  const config = JSON.parse(row!.config);
  config.fields.firstname.label = "Nombre preferido";
  await env.DB.prepare(
    "UPDATE crm_objects SET label=?,config=? WHERE tenant_id=? AND name=?",
  )
    .bind(
      "Mis contactos",
      JSON.stringify(config),
      context.tenant,
      "hubspot_contacts",
    )
    .run();
  expect((await request("/api/crm-workspace/install", "POST", {})).status).toBe(
    200,
  );
  const after = await env.DB.prepare(
    "SELECT label,config FROM crm_objects WHERE tenant_id=? AND name=?",
  )
    .bind(context.tenant, "hubspot_contacts")
    .first<{ label: string; config: string }>();
  expect(after!.label).toBe("Mis contactos");
  expect(JSON.parse(after!.config).fields.firstname.label).toBe(
    "Nombre preferido",
  );
});
it("accepts a full record edit while excluding server-owned metadata from provider body", async () => {
  const response = await request("/api/records/hubspot_contacts/7", "PATCH", {
    id: "7",
    created_at: "now",
    updated_at: "now",
    _version: 1,
    _crmLinks: [],
    firstname: "Grace",
  });
  expect(response.status).toBe(200);
  expect(calls.at(-1).body).toEqual({ properties: { firstname: "Grace" } });
});
it("validates mandatory create fields and rejects traversal ids", async () => {
  expect(
    (await request("/api/records/hubspot_companies", "POST", { name: "" }))
      .status,
  ).toBe(422);
  const count = calls.length;
  expect(
    (await request("/api/records/hubspot_contacts/%2e%2e%2fcompanies")).status,
  ).toBe(422);
  expect(calls).toHaveLength(count);
});
it("normalizes provider datetime and date fields without silently losing time", async () => {
  const row = await env.DB.prepare(
    "SELECT config FROM crm_collection_bindings WHERE tenant_id=? AND object_name=?",
  )
    .bind(context.tenant, "hubspot_contacts")
    .first<{ config: string }>();
  const original = row!.config;
  const binding = JSON.parse(original);
  binding.propertyTypes.firstname = "datetime";
  await env.DB.prepare(
    "UPDATE crm_collection_bindings SET config=? WHERE tenant_id=? AND object_name=?",
  )
    .bind(JSON.stringify(binding), context.tenant, "hubspot_contacts")
    .run();
  expect(
    (
      await request("/api/records/hubspot_contacts/7", "PATCH", {
        firstname: "2026-09-11T09:30:00-05:00",
      })
    ).status,
  ).toBe(200);
  expect(calls.at(-1).body.properties.firstname).toBe(
    "2026-09-11T14:30:00.000Z",
  );
  expect(
    (
      await request("/api/records/hubspot_contacts/7", "PATCH", {
        firstname: "2026-09-11",
      })
    ).status,
  ).toBe(422);
  binding.propertyTypes.firstname = "date";
  await env.DB.prepare(
    "UPDATE crm_collection_bindings SET config=? WHERE tenant_id=? AND object_name=?",
  )
    .bind(JSON.stringify(binding), context.tenant, "hubspot_contacts")
    .run();
  expect(
    (
      await request("/api/records/hubspot_contacts/7", "PATCH", {
        firstname: "2026-09-11",
      })
    ).status,
  ).toBe(200);
  expect(calls.at(-1).body.properties.firstname).toBe(
    String(Date.parse("2026-09-11T00:00:00Z")),
  );
  await env.DB.prepare(
    "UPDATE crm_collection_bindings SET config=? WHERE tenant_id=? AND object_name=?",
  )
    .bind(original, context.tenant, "hubspot_contacts")
    .run();
});
it("allows explicit reinstall after same-account reconnect but rejects another account", async () => {
  const original = conn;
  conn = { ...original, id: "reconnected" };
  expect((await request("/api/records/hubspot_contacts")).status).toBe(403);
  expect((await request("/api/crm-workspace/install", "POST", {})).status).toBe(
    200,
  );
  expect((await request("/api/records/hubspot_contacts")).status).toBe(200);
  conn = { ...conn, externalAccountId: "another-account" };
  expect((await request("/api/crm-workspace/install", "POST", {})).status).toBe(
    403,
  );
  conn = original;
  expect((await request("/api/crm-workspace/install", "POST", {})).status).toBe(
    200,
  );
});
it("does not partially update installed metadata when a later provider inspection fails", async () => {
  const before = await env.DB.prepare(
    "SELECT version FROM crm_objects WHERE tenant_id=? AND name=?",
  )
    .bind(context.tenant, "hubspot_contacts")
    .first<{ version: number }>();
  const proxy = context.crm.nango.proxy;
  context.crm.nango.proxy = async (r: any) =>
    r.path === "/crm/v3/properties/companies"
      ? new Response(null, { status: 500 })
      : proxy(r);
  try {
    expect(
      (await request("/api/crm-workspace/install", "POST", {})).status,
    ).toBe(502);
    const after = await env.DB.prepare(
      "SELECT version FROM crm_objects WHERE tenant_id=? AND name=?",
    )
      .bind(context.tenant, "hubspot_contacts")
      .first<{ version: number }>();
    expect(after!.version).toBe(before!.version);
  } finally {
    context.crm.nango.proxy = proxy;
  }
});
it("refreshes generated datetime labels and flags while preserving customized labels", async () => {
  const proxy = context.crm.nango.proxy;
  context.crm.nango.proxy = async (r: any) => {
    if (r.path === "/crm/v3/properties/contacts")
      return Response.json({
        results: [
          { name: "firstname", type: "datetime" },
          { name: "lastname", type: "datetime" },
        ],
      });
    return proxy(r);
  };
  try {
    const row = await env.DB.prepare(
      "SELECT config FROM crm_objects WHERE tenant_id=? AND name=?",
    )
      .bind(context.tenant, "hubspot_contacts")
      .first<{ config: string }>();
    const config = JSON.parse(row!.config);
    config.fields.firstname.label = "Nombres (fecha y hora ISO)";
    config.fields.firstname.config = {
      dateTime: false,
      placeholder: "2026-09-11T14:30:00-05:00",
    };
    config.fields.lastname.label = "Mi fecha personalizada";
    await env.DB.prepare(
      "UPDATE crm_objects SET config=? WHERE tenant_id=? AND name=?",
    )
      .bind(JSON.stringify(config), context.tenant, "hubspot_contacts")
      .run();
    expect(
      (await request("/api/crm-workspace/install", "POST", {})).status,
    ).toBe(200);
    const after = await env.DB.prepare(
      "SELECT config FROM crm_objects WHERE tenant_id=? AND name=?",
    )
      .bind(context.tenant, "hubspot_contacts")
      .first<{ config: string }>();
    const fields = JSON.parse(after!.config).fields;
    expect(fields.firstname.label).toBe("Nombres");
    expect(fields.firstname.config.dateTime).toBe(true);
    expect(fields.firstname.config.placeholder).toBeUndefined();
    expect(fields.lastname.label).toBe("Mi fecha personalizada");
    expect(fields.lastname.config.dateTime).toBe(true);
  } finally {
    context.crm.nango.proxy = proxy;
  }
});

it("shares installed collections with authorized domain users without their own connection", async () => {
  const teammate = {
    ...context,
    actor: {
      principal: { id: "teammate", isActive: true },
      globalRoles: ["platform_admin"],
      memberships: [],
    },
  };
  const response = await createHubspotWorkspaceApp(teammate).request(
    "/api/records/hubspot_contacts",
  );
  expect(response.status).toBe(200);
  expect(calls.at(-1).connection.id).toBe(conn.id);
  const audit = await env.DB.prepare(
    "SELECT detail FROM crm_audit WHERE tenant_id=? AND action='hubspot.read' ORDER BY rowid DESC LIMIT 1",
  )
    .bind(context.tenant)
    .first<{ detail: string }>();
  expect(JSON.parse(audit!.detail).principalId).toBe("teammate");
});
it("does not share a legacy personal binding or allow inactive actors", async () => {
  const row = await env.DB.prepare(
    "SELECT config FROM crm_collection_bindings WHERE tenant_id=? AND object_name='hubspot_contacts'",
  )
    .bind(context.tenant)
    .first<{ config: string }>();
  const original = row!.config;
  const privateBinding = JSON.parse(original);
  delete privateBinding.accessScope;
  await env.DB.prepare(
    "UPDATE crm_collection_bindings SET config=? WHERE tenant_id=? AND object_name='hubspot_contacts'",
  )
    .bind(JSON.stringify(privateBinding), context.tenant)
    .run();
  const teammate = {
    ...context,
    actor: {
      principal: { id: "teammate", isActive: true },
      globalRoles: ["platform_admin"],
      memberships: [],
    },
  };
  expect(
    (
      await createHubspotWorkspaceApp(teammate).request(
        "/api/records/hubspot_contacts",
      )
    ).status,
  ).toBe(403);
  await env.DB.prepare(
    "UPDATE crm_collection_bindings SET config=? WHERE tenant_id=? AND object_name='hubspot_contacts'",
  )
    .bind(original, context.tenant)
    .run();
  teammate.actor.principal.isActive = false;
  expect(
    (
      await createHubspotWorkspaceApp(teammate).request(
        "/api/records/hubspot_contacts",
      )
    ).status,
  ).toBe(403);
});

it("lets a tenant member read the shared connection but blocks writes, inactive membership and revoked connections", async () => {
  const tenantContext = { ...context, tenant: "agency:101" };
  expect(
    (
      await createHubspotWorkspaceApp(tenantContext).request(
        "/api/crm-workspace/install",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        },
      )
    ).status,
  ).toBe(200);
  const member = {
    ...tenantContext,
    actor: {
      principal: { id: "member", isActive: true },
      globalRoles: [],
      memberships: [{ tenantId: 101, isActive: true, role: "viewer" }],
    },
  };
  expect(
    (
      await createHubspotWorkspaceApp(member as any).request(
        "/api/records/hubspot_contacts",
      )
    ).status,
  ).toBe(200);
  expect(calls.at(-1).connection.id).toBe(conn.id);
  expect(
    (
      await createHubspotWorkspaceApp(member as any).request(
        "/api/records/hubspot_contacts/7",
        { method: "DELETE" },
      )
    ).status,
  ).toBe(403);
  member.actor.memberships[0].isActive = false;
  expect(
    (
      await createHubspotWorkspaceApp(member as any).request(
        "/api/records/hubspot_contacts",
      )
    ).status,
  ).toBe(403);
  member.actor.memberships[0].isActive = true;
  const before = conn;
  conn = { ...conn, status: "disconnected" };
  expect(
    (
      await createHubspotWorkspaceApp(member as any).request(
        "/api/records/hubspot_contacts",
      )
    ).status,
  ).toBe(409);
  conn = before;
});

it("shares related records while excluding private targets and auditing batch reads as reads", async () => {
  const member = {
    ...context,
    tenant: "agency:101",
    actor: {
      principal: { id: "member", isActive: true },
      globalRoles: [],
      memberships: [{ tenantId: 101, isActive: true, role: "viewer" }],
    },
  };
  const response = await createHubspotWorkspaceApp(member as any).request(
    "/api/record-links/hubspot_contacts/7",
  );
  expect(response.status).toBe(200);
  const data = ((await response.json()) as any).data;
  expect(
    data.find((item: any) => item.targetObject === "hubspot_companies").records,
  ).toEqual([{ id: "9", label: "Acme" }]);
  const events = await env.DB.prepare(
    "SELECT action,detail FROM crm_audit WHERE tenant_id=?",
  )
    .bind(member.tenant)
    .all<{ action: string; detail: string }>();
  const memberPosts = events.results.filter((event) => {
    const detail = JSON.parse(event.detail);
    return detail.principalId === "member" && detail.method === "POST";
  });
  expect(memberPosts.length).toBeGreaterThan(0);
  expect(memberPosts.every((event) => event.action === "hubspot.read")).toBe(
    true,
  );
  await env.DB.prepare(
    "UPDATE crm_collection_bindings SET config=json_remove(config,'$.accessScope') WHERE tenant_id=? AND object_name='hubspot_companies'",
  )
    .bind(member.tenant)
    .run();
  const privateResponse = await createHubspotWorkspaceApp(
    member as any,
  ).request("/api/record-links/hubspot_contacts/7");
  expect(privateResponse.status).toBe(200);
  expect(
    ((await privateResponse.json()) as any).data.some(
      (item: any) => item.targetObject === "hubspot_companies",
    ),
  ).toBe(false);
});
