import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, expect, it, vi } from "vitest";
import {
  createRemoteWorkspaceApp,
  handlesRemoteWorkspace,
} from "../src/external-crm/remote-workspace";

const state = vi.hoisted(() => ({
  account: "account-1",
  connected: true,
  writable: true,
  calls: [] as any[],
}));
vi.mock("../src/external-crm/repository", () => ({
  createCrmRepository: () => ({
    findActiveConnection: async (
      tenantId: number,
      provider: string,
      owner: string,
    ) =>
      [99810, 99811].includes(tenantId) &&
      ["owner", "other-admin"].includes(owner) &&
      state.connected
        ? {
            id:
              provider +
              (owner === "owner" ? "-connection" : "-other-connection"),
            provider,
            status: "connected",
            externalAccountId: state.account,
            externalAccountLabel: "Test account",
            scopes: [],
          }
        : undefined,
    findActiveConnectionForPrincipal: async (
      provider: string,
      owner: string,
    ) =>
      ["owner", "other-admin"].includes(owner) && state.connected
        ? {
            id:
              provider +
              (owner === "owner" ? "-connection" : "-other-connection"),
            provider,
            status: "connected",
            externalAccountId: state.account,
            externalAccountLabel: "Test account",
            scopes: [],
          }
        : undefined,
  }),
}));
vi.mock("../src/external-crm/workspace-adapter", () => ({
  createRemoteWorkspaceAdapter: (provider: string) => ({
    canEditLink: (resource: string, target: string) =>
      resource === "contacts" && target === "companies",
    setLink: async (
      _: any,
      resource: string,
      id: string,
      target: string,
      targetId: string,
      remove: boolean,
    ) => {
      state.calls.push({ resource, id, target, targetId, remove });
    },
    resources: ["contacts", "companies", "deals"].map((resource) => ({
      resource,
      label: resource,
    })),
    describe: async () => ({
      title: "name",
      fields: {
        name: { type: "Textbox", label: "Name", required: true },
        computed: { type: "Textbox", label: "Computed", readOnly: true },
      },
      capabilities: {
        list: true,
        read: true,
        create: state.writable,
        update: state.writable,
        delete: false,
        schema: false,
        customFields: false,
        search: true,
        filter: false,
        sort: false,
      },
    }),
    list: async () => ({
      records: [{ id: "123", name: provider }],
      hasNextPage: true,
    }),
    get: async () => ({ id: "123", name: provider }),
    create: async (_: any, resource: string, data: any) => {
      state.calls.push({ provider, resource, data });
      return { id: "124", ...data };
    },
    update: async (_: any, resource: string, id: string, data: any) => {
      state.calls.push({ provider, resource, id, data });
      return { id, ...data };
    },
    links: async () => ({
      records: [{ id: "456", name: "Related" }],
      hasNextPage: false,
      total: 1,
    }),
  }),
}));
const tenant = "tenant:99810";
const owner = {
  principal: { id: "owner", isActive: true },
  globalRoles: ["platform_admin"],
  memberships: [],
};
const member = {
  principal: { id: "member", isActive: true },
  globalRoles: [],
  memberships: [{ tenantId: 99810, isActive: true, role: "member" }],
};
const context = (actor: any = owner) =>
  ({
    db: env.DB,
    files: env.FILES,
    tenant,
    actor,
    seedObjects: [],
    crm: { nango: {} },
  }) as any;
const request = (
  path: string,
  method = "GET",
  body?: unknown,
  actor: any = owner,
) =>
  createRemoteWorkspaceApp(context(actor)).request("/api/" + path, {
    method,
    ...(body === undefined
      ? {}
      : {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
const requestForTenant = (
  tenantId: number,
  path: string,
  method = "GET",
  body?: unknown,
) =>
  createRemoteWorkspaceApp({
    ...context(),
    tenant: `tenant:${tenantId}`,
  }).request("/api/" + path, {
    method,
    ...(body === undefined
      ? {}
      : {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
async function install(provider = "salesforce") {
  const result = await request(`crm-workspace/${provider}/install`, "POST", {
    resources: ["contacts", "companies", "deals"],
  });
  expect(await result.clone().text()).not.toContain("error");
  expect(result.status).toBe(200);
  return result;
}
it("does not borrow a same-principal CRM connection from another tenant", async () => {
  const foreignInstall = await requestForTenant(
    99811,
    "crm-workspace/salesforce/install",
    "POST",
    { resources: ["contacts"] },
  );
  expect(foreignInstall.status).toBe(200);

  const object = await env.DB.prepare(
    "SELECT label,description,config FROM studio_objects WHERE tenant_id=? AND name=?",
  )
    .bind("tenant:99811", "salesforce_contacts")
    .first<{ label: string; description: string; config: string }>();
  const binding = await env.DB.prepare(
    "SELECT source_id,resource,config FROM crm_collection_bindings WHERE tenant_id=? AND object_name=?",
  )
    .bind("tenant:99811", "salesforce_contacts")
    .first<{ source_id: string; resource: string; config: string }>();
  await env.DB.prepare(
    "INSERT INTO studio_objects(tenant_id,name,label,description,config) VALUES (?,?,?,?,?)",
  )
    .bind(
      "tenant:99812",
      "salesforce_contacts",
      object!.label,
      object!.description,
      object!.config,
    )
    .run();
  await env.DB.prepare(
    "INSERT INTO crm_collection_bindings(tenant_id,object_name,source_id,resource,config) VALUES (?,?,?,?,?)",
  )
    .bind(
      "tenant:99812",
      "salesforce_contacts",
      binding!.source_id,
      binding!.resource,
      binding!.config,
    )
    .run();

  const discovery = await requestForTenant(99812, "crm-workspace/salesforce");
  expect((await discovery.json()) as any).toMatchObject({
    data: { connected: false, objects: [] },
  });
  expect(
    (
      await requestForTenant(
        99812,
        "crm-workspace/salesforce/install",
        "POST",
        { resources: ["contacts"] },
      )
    ).status,
  ).toBe(409);
  expect(
    (await requestForTenant(99812, "records/salesforce_contacts")).status,
  ).toBe(409);
});
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
beforeEach(async () => {
  state.account = "account-1";
  state.connected = true;
  state.writable = true;
  state.calls = [];
  for (const table of [
    "crm_collection_bindings",
    "studio_schema_versions",
    "studio_objects",
  ])
    await env.DB.prepare(`DELETE FROM ${table} WHERE tenant_id=?`)
      .bind(tenant)
      .run();
});
it.each(["salesforce", "zoho", "pipedrive"])(
  "installs and reads %s screens with bound provider identity",
  async (provider) => {
    const response = await install(provider);
    expect(((await response.json()) as any).data.objects).toHaveLength(3);
    const listed = await request(`records/${provider}_contacts`);
    expect((await listed.json()) as any).toMatchObject({
      data: [{ id: "123", name: provider }],
      pageInfo: { hasNextPage: true },
    });
    const created = await request(`records/${provider}_contacts`, "POST", {
      name: "Ada",
    });
    expect(created.status).toBe(201);
    expect(state.calls).toEqual([
      { provider, resource: "contacts", data: { name: "Ada" } },
    ]);
  },
);
it("keeps labels and installs idempotently without overwriting another account", async () => {
  await install();
  await env.DB.prepare(
    "UPDATE studio_objects SET label=? WHERE tenant_id=? AND name=?",
  )
    .bind("My contacts", tenant, "salesforce_contacts")
    .run();
  await install();
  const row = await env.DB.prepare(
    "SELECT label FROM studio_objects WHERE tenant_id=? AND name=?",
  )
    .bind(tenant, "salesforce_contacts")
    .first();
  expect(row?.label).toBe("My contacts");
  state.account = "other-account";
  expect(
    (
      await request("crm-workspace/salesforce/install", "POST", {
        resources: ["contacts"],
      })
    ).status,
  ).toBe(409);
  expect((await request("records/salesforce_contacts")).status).toBe(403);
});
it("allows tenant member reads using the owner connection but refuses writes and outsiders", async () => {
  await install();
  expect(
    (await request("records/salesforce_contacts", "GET", undefined, member))
      .status,
  ).toBe(200);
  expect(
    (
      await request(
        "records/salesforce_contacts",
        "POST",
        { name: "No" },
        member,
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await request("records/salesforce_contacts", "GET", undefined, {
        ...member,
        memberships: [],
      })
    ).status,
  ).toBe(403);
  state.connected = false;
  expect(
    (await request("records/salesforce_contacts", "GET", undefined, member))
      .status,
  ).toBe(409);
});
it("does not share a personal binding or honor a forged provider", async () => {
  await install();
  const row = await env.DB.prepare(
    "SELECT config FROM crm_collection_bindings WHERE tenant_id=? AND object_name=?",
  )
    .bind(tenant, "salesforce_contacts")
    .first<{ config: string }>();
  const binding = JSON.parse(row!.config);
  delete binding.accessScope;
  await env.DB.prepare(
    "UPDATE crm_collection_bindings SET config=? WHERE tenant_id=? AND object_name=?",
  )
    .bind(JSON.stringify(binding), tenant, "salesforce_contacts")
    .run();
  expect(
    (await request("records/salesforce_contacts", "GET", undefined, member))
      .status,
  ).toBe(403);
  binding.provider = "zoho";
  await env.DB.prepare(
    "UPDATE crm_collection_bindings SET config=? WHERE tenant_id=? AND object_name=?",
  )
    .bind(JSON.stringify(binding), tenant, "salesforce_contacts")
    .run();
  expect((await request("records/salesforce_contacts")).status).toBe(403);
});
it("rejects invalid selection before installing any screens", async () => {
  expect(
    (
      await request("crm-workspace/salesforce/install", "POST", {
        resources: ["contacts", "invalid"],
      })
    ).status,
  ).toBe(422);
  const row = await env.DB.prepare(
    "SELECT count(*) AS n FROM studio_objects WHERE tenant_id=?",
  )
    .bind(tenant)
    .first();
  expect(row?.n).toBe(0);
});
it("rechecks permissions and rejects readonly/unknown fields, invalid pagination and deletion", async () => {
  await install();
  expect(
    (await request("records/salesforce_contacts", "POST", { computed: "No" }))
      .status,
  ).toBe(422);
  expect(
    (await request("records/salesforce_contacts", "POST", { bad: "No" }))
      .status,
  ).toBe(422);
  expect(
    (await request("records/salesforce_contacts", "POST", {})).status,
  ).toBe(422);
  expect((await request("records/salesforce_contacts?page=101")).status).toBe(
    422,
  );
  expect((await request("records/salesforce_contacts?filters=x")).status).toBe(
    422,
  );
  expect(
    (await request("records/salesforce_contacts/123", "DELETE")).status,
  ).toBe(405);
  state.writable = false;
  expect(
    (await request("records/salesforce_contacts/123", "PATCH", { name: "No" }))
      .status,
  ).toBe(405);
  expect(state.calls).toEqual([]);
});
it("lists only same-provider same-account installed relationship groups", async () => {
  await install();
  await install("zoho");
  const response = await request("record-links/salesforce_contacts/123");
  expect(response.status).toBe(200);
  const data = ((await response.json()) as any).data;
  expect(
    data.every((group: any) => group.targetObject.startsWith("salesforce_")),
  ).toBe(true);
  expect(
    data.some((group: any) => group.targetObject === "salesforce_companies"),
  ).toBe(true);
});
it("dispatches new providers without stealing legacy HubSpot routes", async () => {
  await install();
  expect(
    await handlesRemoteWorkspace(context(), "/api/crm-workspace/zoho"),
  ).toBe(true);
  expect(
    await handlesRemoteWorkspace(context(), "/api/records/salesforce_contacts"),
  ).toBe(true);
  expect(await handlesRemoteWorkspace(context(), "/api/crm-workspace")).toBe(
    false,
  );
  expect(
    await handlesRemoteWorkspace(context(), "/api/records/hubspot_contacts"),
  ).toBe(false);
});
it("routes remote records through the collection gateway and grants shared members read only", async () => {
  const { createCollectionGateway } =
    await import("../src/studio/collection-gateway");
  const { compatibilityGrants } =
    await import("../src/auth/access-compatibility");
  for (const provider of ["salesforce", "zoho", "pipedrive"]) {
    await install(provider);
    const gateway = createCollectionGateway(context(member));
    const result = await gateway.fetch(
      new Request(`https://savia.test/api/records/${provider}_contacts`),
    );
    expect(result.status).toBe(200);
    expect(((await result.json()) as any).data[0].name).toBe(provider);
  }
  const grants = await compatibilityGrants(env.DB, tenant as any, {
    platform: false,
    manager: false,
    legacyRole: "member",
  });
  for (const provider of ["salesforce", "zoho", "pipedrive"]) {
    const matching = grants.filter(
      (grant) => grant.resource === `collection:${provider}_contacts`,
    );
    expect(matching.map((grant) => grant.action)).toEqual(["read"]);
  }
});

it("edits only advertised relationship directions and requires tenant administration", async () => {
  await install();
  const relation = "salesforce:salesforce_contacts:salesforce_companies";
  expect(
    (
      await request(
        `record-links/salesforce_contacts/123/${encodeURIComponent(relation)}`,
        "POST",
        { targetId: "456" },
      )
    ).status,
  ).toBe(200);
  expect(state.calls).toContainEqual({
    resource: "contacts",
    id: "123",
    target: "companies",
    targetId: "456",
    remove: false,
  });
  const reverse = "salesforce:salesforce_companies:salesforce_contacts";
  expect(
    (
      await request(
        `record-links/salesforce_companies/456/${encodeURIComponent(reverse)}`,
        "POST",
        { targetId: "123" },
      )
    ).status,
  ).toBe(405);
  expect(
    (
      await request(
        `record-links/salesforce_contacts/123/${encodeURIComponent(relation)}`,
        "DELETE",
        { targetId: "456" },
        member,
      )
    ).status,
  ).toBe(403);
});

it("preserves personal scope when the owner reinstalls a CRM screen", async () => {
  await install();
  const row = await env.DB.prepare(
    "SELECT config FROM crm_collection_bindings WHERE tenant_id=? AND object_name=?",
  )
    .bind(tenant, "salesforce_contacts")
    .first<{ config: string }>();
  const binding = JSON.parse(row!.config);
  delete binding.accessScope;
  await env.DB.prepare(
    "UPDATE crm_collection_bindings SET config=? WHERE tenant_id=? AND object_name=?",
  )
    .bind(JSON.stringify(binding), tenant, "salesforce_contacts")
    .run();
  await install();
  expect(
    (await request("records/salesforce_contacts", "GET", undefined, member))
      .status,
  ).toBe(403);
});
it("reports existing shared screens as installed to another administrator of the same account", async () => {
  await install();
  const other = { ...owner, principal: { id: "other-admin", isActive: true } };
  const response = await request(
    "crm-workspace/salesforce",
    "GET",
    undefined,
    other,
  );
  expect(response.status).toBe(200);
  expect(
    ((await response.json()) as any).data.objects.every(
      (item: any) => item.installed,
    ),
  ).toBe(true);
});
