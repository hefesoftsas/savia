import { env } from "cloudflare:workers";
import { beforeAll, expect, it } from "vitest";
import { createCollectionSourceApp } from "../src/crm/collection-sources";
import type { DatabaseBridgeClient } from "../src/crm/database-bridge";
const migrations = Object.entries(
  import.meta.glob<string>("../../../packages/db/migrations/*.sql", {
    eager: true,
    import: "default",
    query: "?raw",
  }),
).sort(([a], [b]) => a.localeCompare(b));
beforeAll(async () => {
  for (const [, sql] of migrations)
    for (const part of sql.split("--> statement-breakpoint")) {
      const statement = part
        .replace(/^--.*$/gm, "")
        .replace(/\s+/g, " ")
        .trim();
      if (statement) await env.DB.exec(statement);
    }
});
const meta = {
  resource: "orders",
  kind: "table" as const,
  fields: [
    {
      name: "id",
      nativeType: "text",
      valueType: "string" as const,
      nullable: false,
      generated: false,
      writable: true,
      hasDefault: false,
    },
    {
      name: "name",
      nativeType: "text",
      valueType: "string" as const,
      nullable: false,
      generated: false,
      writable: true,
      hasDefault: false,
    },
  ],
  primaryKey: ["id"],
  uniqueKeys: [],
  sampled: false,
};
const writes: unknown[] = [];
const bridge: DatabaseBridgeClient = {
  testConnection: async () => {},
  listResources: async () => [{ resource: "orders", kind: "table" }],
  inspect: async () => meta,
  read: async () => ({ data: [{ id: "1", name: "Acme" }], hasNext: false }),
  mutate: async (input) => {
    writes.push(input);
    return { data: { id: "1", name: "Updated" } };
  },
};
const KEY = "source-test-key-at-least-thirty-two-characters";
function makeApp(owner = "owner", tenant = "database-tests") {
  return createCollectionSourceApp(
    env.DB,
    env.DOCUMENTS,
    tenant,
    owner,
    KEY,
    undefined,
    undefined,
    undefined,
    bridge,
  );
}
const app = makeApp();
const call = (path: string, method = "GET", body?: unknown, target = app) =>
  target.request(`http://localhost/api/${path}`, {
    method,
    headers: { "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
it.each(["postgres", "mysql", "mssql", "mongodb"])(
  "creates and tests a %s source without exposing secrets",
  async (kind) => {
    const response = await call("sources", "POST", {
      id: kind,
      label: kind,
      kind,
      host: "db.internal",
      database: "erp",
      username: "writer",
      password: "private",
      writeEnabled: true,
    });
    expect(response.status, await response.clone().text()).toBe(201);
    expect(await response.text()).not.toContain("private");
    expect((await call(`sources/${kind}/test`, "POST", {})).status).toBe(200);
  },
);
it("enforces current source policy and owner identity before native writes", async () => {
  await call("sources", "POST", {
    id: "policy",
    label: "Policy",
    kind: "mysql",
    host: "db.internal",
    database: "erp",
    username: "writer",
    password: "private",
    writeEnabled: true,
  });
  const binding = await call("collection-bindings", "POST", {
    name: "orders",
    label: "Orders",
    sourceId: "policy",
    resource: "orders",
    fields: {
      id: { type: "Textbox", label: "ID" },
      name: { type: "Textbox", label: "Name" },
    },
  });
  expect(binding.status, await binding.clone().text()).toBe(201);
  expect(
    (await call("records/orders/1", "PATCH", { name: "Updated" })).status,
  ).toBe(200);
  const before = writes.length;
  expect(
    (await call("sources/policy", "PUT", { writeEnabled: false })).status,
  ).toBe(200);
  expect((await call("records/orders/1", "PATCH", { name: "No" })).status).toBe(
    405,
  );
  expect(writes).toHaveLength(before);
  expect(
    (await call("records/orders/1", "PATCH", { name: "No" }, makeApp("other")))
      .status,
  ).toBe(404);
  expect(
    (await call("sources/policy/test", "POST", {}, makeApp("other"))).status,
  ).toBe(404);
});

it("rejects undeclared writes and synchronizes metadata with version guards", async () => {
  await call("sources", "POST", {
    id: "sync",
    label: "Sync",
    kind: "postgres",
    host: "db.internal",
    database: "erp",
    username: "writer",
    password: "private",
    writeEnabled: true,
  });
  const bound = await call("collection-bindings", "POST", {
    name: "synced",
    label: "Synced",
    sourceId: "sync",
    resource: "orders",
    fields: {
      id: { type: "Textbox", label: "External ID" },
      name: { type: "Textbox", label: "Customer" },
    },
  });
  expect(bound.status).toBe(201);
  const before = writes.length;
  expect(
    (await call("records/synced/1", "PATCH", { secret: "no" })).status,
  ).toBe(422);
  expect((await call("records/synced/1", "PATCH", { id: "2" })).status).toBe(
    422,
  );
  expect(writes).toHaveLength(before);
  expect(
    (await call("collection-bindings/synced/sync", "POST", { version: 99 }))
      .status,
  ).toBe(409);
  const synced = await call("collection-bindings/synced/sync", "POST", {
    version: 1,
  });
  expect(synced.status, await synced.clone().text()).toBe(200);
  expect(((await synced.json()) as any).data.config.fields.name.label).toBe(
    "Customer",
  );
  expect(
    (
      await call("collection-bindings/synced/operations", "PUT", {
        version: 2,
        operations: {},
      })
    ).status,
  ).toBe(405);
  expect(
    (
      await call(
        "sources/sync/test",
        "POST",
        {},
        makeApp("owner", "other-tenant"),
      )
    ).status,
  ).toBe(404);
});

it("persists source policy changes into collection metadata for catalog refresh", async () => {
  await call("sources", "POST", {
    id: "catalog",
    label: "Catalog",
    kind: "mysql",
    host: "db.internal",
    database: "erp",
    username: "writer",
    writeEnabled: true,
  });
  await call("collection-bindings", "POST", {
    name: "catalog_orders",
    label: "Catalog orders",
    sourceId: "catalog",
    resource: "orders",
    fields: {
      id: { type: "Textbox", label: "ID" },
      name: { type: "Textbox", label: "Name" },
    },
  });
  await call("sources/catalog", "PUT", { writeEnabled: false });
  const row = await env.DB.prepare(
    "SELECT config FROM crm_objects WHERE tenant_id=? AND name=?",
  )
    .bind("database-tests", "catalog_orders")
    .first<{ config: string }>();
  expect(JSON.parse(row!.config).studio.capabilities.update).toBe(false);
});
