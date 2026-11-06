import { OpenAPIHono } from "@hono/zod-openapi";
import { authenticationMiddleware } from "../src/auth/middleware";
import { registerCompanionRoutes } from "../src/companion/routes";
import { env } from "cloudflare:workers";
import { beforeAll, expect, it } from "vitest";
import { createAccessFixture } from "./access-control-fixtures";
import { createTestApp } from "./test-app";
import { betterAuthAuthenticator } from "../src/auth/better-auth";
import {
  PersonalApiKeys,
  type ApiKeyScope,
} from "../src/auth/personal-api-keys";
import {
  loadAccessPolicy,
  saveAccessRole,
  replaceAccessAssignments,
} from "../src/auth/access-repository";
let f: Awaited<ReturnType<typeof createAccessFixture>>;
let keys: PersonalApiKeys;
let rowId: string;
let hiddenId: string;
let roleId: string;
const base = "/v1/studio/101/api";
beforeAll(async () => {
  f = await createAccessFixture();
  keys = new PersonalApiKeys(f.db, "preview");
  const admin = await f.actor("agency_admin");
  const role = await saveAccessRole(f.db, admin, {
    scope: "tenant:101",
    name: "key_native",
    label: "Key native",
    description: "",
    enabled: true,
    expectedRevision: (await loadAccessPolicy(f.db, admin, "tenant:101"))
      .revision,
    grants: [
      {
        resource: "page:acl_contacts",
        action: "read",
        predicate: { all: true },
        fields: [],
      },
      ...(["read", "create", "update"] as const).map((action) => ({
        resource: "collection:acl_contacts" as const,
        action,
        predicate: {
          field: "commission",
          op: "lt" as const,
          value: { literal: 150 },
        },
        fields: ["name"],
      })),
    ],
  });
  roleId = role.id;
  await replaceAccessAssignments(f.db, admin, {
    scope: "tenant:101",
    principalId: f.principalId("viewer"),
    roleIds: [role.id],
    expectedRevision: role.revision,
  });
  rowId = (await f.db
    .prepare(
      "SELECT id FROM studio_records WHERE tenant_id='tenant:101' AND object_name='acl_contacts'",
    )
    .first<{ id: string }>())!.id;
  const hidden = await f.request(
    "agency_admin",
    101,
    base + "/records/acl_contacts",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Hidden", commission: 200 }),
    },
  );
  hiddenId = ((await hidden.json()) as { data: { id: string } }).data.id;
});
async function key(
  role: "agency_admin" | "viewer" | "operator",
  scopes: ApiKeyScope[],
) {
  return keys.create(await f.actor(role), {
    name: "Native data",
    tenantId: 101,
    scopes,
  });
}
function request(secret: string, path: string, method = "GET", body?: unknown) {
  const app = createTestApp({
    documents: env.DOCUMENTS,
    auth: betterAuthAuthenticator(undefined, undefined, keys),
  });
  return app.request(path, {
    method,
    headers: {
      authorization: `Bearer ${secret}`,
      "content-type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
it("filters rows, totals, metadata and fields using the current owner policy", async () => {
  const { secret } = await key("viewer", ["records:read"]);
  const res = await request(secret, base + "/records/acl_contacts?perPage=1");
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    data: Record<string, unknown>[];
    total: number;
  };
  expect(body.total).toBe(1);
  expect(body.data).toHaveLength(1);
  expect(body.data[0].name).toBe("Tenant 101");
  expect(body.data[0]).not.toHaveProperty("commission");
  expect(
    (await request(secret, base + "/records/acl_contacts/" + hiddenId)).status,
  ).toBe(403);
  expect(
    (await request(secret, base + "/records/acl_contacts?sort=commission"))
      .status,
  ).toBe(403);
  const objects = await request(secret, base + "/objects");
  expect(objects.status).toBe(200);
  expect(await objects.text()).not.toContain('"commission"');
});
it("allows admin create/update but separates them from reading and deleting", async () => {
  const { secret } = await key("agency_admin", [
    "records:create",
    "records:update",
  ]);
  expect((await request(secret, base + "/records/acl_contacts")).status).toBe(
    403,
  );
  const created = await request(
    secret,
    base + "/records/acl_contacts",
    "POST",
    { name: "Created by key", commission: 12 },
  );
  expect(created.status).toBe(201);
  const body = (await created.json()) as {
    data: { id: string; name?: string; commission?: number };
  };
  expect(body.data).not.toHaveProperty("commission");
  expect(body.data).not.toHaveProperty("name");
  const updated = await request(
    secret,
    base + "/records/acl_contacts/" + body.data.id,
    "PATCH",
    { name: "Updated by key", _version: 1 },
  );
  expect(updated.status).toBe(200);
  expect(
    (
      await request(
        secret,
        base + "/records/acl_contacts/" + body.data.id,
        "DELETE",
      )
    ).status,
  ).toBe(403);
});
it("never expands owner field, row, or collection write permissions", async () => {
  const { secret } = await key("viewer", ["records:read", "records:update"]);
  expect(
    (
      await request(secret, base + "/records/acl_contacts/" + rowId, "PATCH", {
        commission: 1,
        _version: 1,
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await request(
        secret,
        base + "/records/acl_contacts/" + hiddenId,
        "PATCH",
        { name: "Escape", _version: 1 },
      )
    ).status,
  ).toBe(403);
  const allowed = await request(
    secret,
    base + "/records/acl_contacts/" + rowId,
    "PATCH",
    { name: "Permitted", _version: 1 },
  );
  expect(allowed.status).toBe(200);
  expect(await allowed.text()).not.toContain("commission");
  const ungranted = await key("operator", [
    "records:read",
    "records:create",
    "records:update",
  ]);
  expect(
    (await request(ungranted.secret, base + "/records/acl_contacts")).status,
  ).toBe(403);
  expect(
    (
      await request(ungranted.secret, base + "/records/acl_contacts", "POST", {
        name: "No grant",
      })
    ).status,
  ).toBe(403);
});
it("keeps mixed key Companion capabilities recording-only", async () => {
  const { secret } = await key("agency_admin", [
    "records:read",
    "records:create",
    "recordings:read",
    "recordings:upload",
  ]);
  const app = new OpenAPIHono();
  app.use(
    "*",
    authenticationMiddleware(
      f.db,
      betterAuthAuthenticator(undefined, undefined, keys),
    ),
  );
  registerCompanionRoutes(app, {
    enabled: true,
    storage: env.DOCUMENTS,
    configuration: {
      effectiveConfigurationFor: async () => ({ model: "test/model" }),
      effectiveConfigurationForTenant: async () => ({ model: "test/model" }),
    },
  });
  const capabilities = await app.request("/v1/companion/capabilities", {
    headers: { authorization: `Bearer ${secret}` },
  });
  expect(capabilities.status).toBe(200);
  expect(
    ((await capabilities.json()) as { grantedRecordingScopes: string[] })
      .grantedRecordingScopes,
  ).toEqual(["recordings:read", "recordings:upload"]);
});
it("binds an administrator key to its tenant and rejects old recording scopes", async () => {
  const { secret } = await key("agency_admin", ["records:read"]);
  expect(
    (await request(secret, "/v1/studio/102/api/records/acl_contacts")).status,
  ).toBe(403);
  const old = await key("agency_admin", [
    "recordings:read",
    "recordings:upload",
  ]);
  expect(
    (await request(old.secret, base + "/records/acl_contacts")).status,
  ).toBe(403);
});
it("denies connected adapters before gateway bypasses and hides their metadata", async () => {
  const row = await f.db
    .prepare(
      "SELECT * FROM studio_objects WHERE tenant_id='tenant:101' AND name='acl_contacts'",
    )
    .first<any>();
  for (const name of ["key_external", "key_business", "key_bound"]) {
    const config = JSON.parse(row.config);
    if (name === "key_external")
      config.studio = { collection: { source: "database" } };
    if (name === "key_business") config.studio = { business: { kind: "test" } };
    await f.db
      .prepare(
        "INSERT INTO studio_objects(tenant_id,name,label,config) VALUES ('tenant:101',?,?,?)",
      )
      .bind(name, name, JSON.stringify(config))
      .run();
  }
  await f.db
    .prepare(
      "INSERT INTO crm_collection_bindings(tenant_id,object_name,source_id,resource,config) VALUES ('tenant:101','key_bound','test','contacts',?)",
    )
    .bind(
      JSON.stringify({
        kind: "crm",
        provider: "hubspot",
        accessScope: "tenant",
      }),
    )
    .run();
  const { secret } = await key("agency_admin", [
    "records:read",
    "records:create",
  ]);
  for (const name of ["key_external", "key_business", "key_bound"]) {
    expect((await request(secret, base + "/records/" + name)).status).toBe(403);
    expect(
      (
        await request(secret, base + "/records/" + name, "POST", {
          name: "Denied",
        })
      ).status,
    ).toBe(403);
  }
  const metadata = await request(secret, base + "/objects");
  expect(metadata.status).toBe(200);
  const text = await metadata.text();
  expect(text).not.toContain("key_external");
  expect(text).not.toContain("key_business");
  expect(text).not.toContain("key_bound");
});
it("reloads owner assignments and membership and honors revocation immediately", async () => {
  const { secret, key: created } = await key("viewer", ["records:read"]);
  const admin = await f.actor("agency_admin");
  await replaceAccessAssignments(f.db, admin, {
    scope: "tenant:101",
    principalId: f.principalId("viewer"),
    roleIds: [],
    expectedRevision: (await loadAccessPolicy(f.db, admin, "tenant:101"))
      .revision,
  });
  expect((await request(secret, base + "/records/acl_contacts")).status).toBe(
    403,
  );
  await replaceAccessAssignments(f.db, admin, {
    scope: "tenant:101",
    principalId: f.principalId("viewer"),
    roleIds: [roleId],
    expectedRevision: (await loadAccessPolicy(f.db, admin, "tenant:101"))
      .revision,
  });
  expect((await request(secret, base + "/records/acl_contacts")).status).toBe(
    200,
  );
  await keys.revoke(f.principalId("viewer"), created.id);
  expect((await request(secret, base + "/records/acl_contacts")).status).toBe(
    401,
  );
  const active = await key("viewer", ["records:read"]);
  await f.db
    .prepare(
      "UPDATE identity_tenant_membership SET is_active=0 WHERE principal_id=?",
    )
    .bind(f.principalId("viewer"))
    .run();
  expect(
    (await request(active.secret, base + "/records/acl_contacts")).status,
  ).toBe(401);
});
