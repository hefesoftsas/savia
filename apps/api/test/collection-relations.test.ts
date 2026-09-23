import { env } from "cloudflare:workers";
import { beforeAll, expect, it } from "vitest";
import { HTTPException } from "hono/http-exception";
import { createCollectionRelationsApp } from "../src/studio/collection-relations";
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
  for (const tenant of ["relations:a", "relations:b"])
    for (const name of ["agencies_test", "clients_test", "other"])
      await env.DB.prepare(
        "INSERT INTO crm_objects(tenant_id,name,label,config) VALUES(?,?,?,?)",
      )
        .bind(tenant, name, name, "{}")
        .run();
});
const appFor = (tenant = "relations:a") =>
  createCollectionRelationsApp({
    db: env.DB,
    tenant,
    readRecord: async (object, id) => {
      if (
        !["agencies_test", "clients_test", "other"].includes(object) ||
        !["1", "2", "3"].includes(id)
      )
        throw new HTTPException(404, { message: "Missing" });
      return { id, name: `${object} ${id}` };
    },
    listRecords: async () => {
      throw Error("No scans");
    },
  });
const call = (path: string, method = "GET", body?: unknown, tenant?: string) =>
  appFor(tenant).request(`http://localhost/api/${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
const definition = async (cardinality = "many-to-many") => {
  const response = await call("collection-relations", "POST", {
    sourceObject: "agencies_test",
    targetObject: "clients_test",
    sourceLabel: "Clientes",
    targetLabel: "Agencias",
    cardinality,
  });
  expect(response.status, await response.clone().text()).toBe(201);
  return ((await response.json()) as any).data;
};
it("keeps links bidirectional, idempotent and tenant scoped; deleting definitions cascades only links", async () => {
  const relation = await definition();
  const path = `record-links/agencies_test/1/${relation.id}`;
  expect((await call(path, "POST", { targetId: "2" })).status).toBe(200);
  expect((await call(path, "POST", { targetId: "2" })).status).toBe(200);
  const source = (await (
    await call("record-links/agencies_test/1")
  ).json()) as any;
  expect(
    source.data.find((g: any) => g.definition.id === relation.id).records,
  ).toEqual([{ id: "2", label: "clients_test 2" }]);
  const target = (await (
    await call("record-links/clients_test/2")
  ).json()) as any;
  expect(
    target.data.find((g: any) => g.definition.id === relation.id),
  ).toMatchObject({
    direction: "incoming",
    total: 1,
    records: [{ id: "1", label: "agencies_test 1" }],
  });
  expect(
    (await call(path, "POST", { targetId: "2" }, "relations:b")).status,
  ).toBe(404);
  expect(
    (
      await call(`record-links/other/1/${relation.id}`, "POST", {
        targetId: "2",
      })
    ).status,
  ).toBe(404);
  expect((await call(path, "POST", { targetId: "missing" })).status).toBe(404);
  expect(
    (await call(`collection-relations/${relation.id}`, "DELETE")).status,
  ).toBe(200);
  expect(
    await env.DB.prepare(
      "SELECT COUNT(*) total FROM crm_record_links WHERE relation_id=?",
    )
      .bind(relation.id)
      .first(),
  ).toEqual({ total: 0 });
});
it("enforces cardinality atomically with concurrent writes, including incoming operations", async () => {
  const relation = await definition("one-to-many");
  const responses = await Promise.all(
    ["1", "2"].map((id) =>
      call(`record-links/agencies_test/${id}/${relation.id}`, "POST", {
        targetId: "3",
      }),
    ),
  );
  expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
  const single = await definition("one-to-one");
  expect(
    (
      await call(`record-links/clients_test/1/${single.id}`, "POST", {
        targetId: "1",
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await call(`record-links/agencies_test/1/${single.id}`, "POST", {
        targetId: "2",
      })
    ).status,
  ).toBe(409);
  expect(
    (
      await call(`record-links/clients_test/1/${single.id}`, "DELETE", {
        targetId: "1",
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await call(`record-links/agencies_test/1/${single.id}`, "POST", {
        targetId: "2",
      })
    ).status,
  ).toBe(200);
});
it("validates definitions and bounded pagination, and hides unreadable collections", async () => {
  expect(
    (
      await call("collection-relations", "POST", {
        sourceObject: "missing",
        targetObject: "clients_test",
        sourceLabel: "A",
        targetLabel: "B",
        cardinality: "many-to-many",
      })
    ).status,
  ).toBe(404);
  expect((await call("record-links/agencies_test/1?perPage=101")).status).toBe(
    422,
  );
  await env.DB.prepare(
    "UPDATE crm_objects SET config=? WHERE tenant_id=? AND name=?",
  )
    .bind(
      JSON.stringify({ studio: { capabilities: { read: false } } }),
      "relations:a",
      "other",
    )
    .run();
  expect((await call("record-links/other/1")).status).toBe(403);
  expect(
    (
      await call("collection-relations", "POST", {
        sourceObject: "other",
        targetObject: "clients_test",
        sourceLabel: "A",
        targetLabel: "B",
        cardinality: "many-to-many",
      })
    ).status,
  ).toBe(403);
});

it("removes local association metadata atomically when a CRM record is deleted", async () => {
  const { createObject } = await import("@savia/studio-server/schema");
  const { createRecord, deleteRecord, getRecord } =
    await import("@savia/studio-server/services");
  const tenant = "relations:delete";
  for (const name of ["a", "b"])
    await createObject(env.DB, tenant, {
      name,
      label: name,
      config: {
        version: 2,
        fields: { name: { type: "Textbox", label: "Nombre" } },
        fieldOrder: ["name"],
      },
    });
  const a = await createRecord(env.DB, tenant, "a", { name: "A" }),
    b = await createRecord(env.DB, tenant, "b", { name: "B" });
  const app = createCollectionRelationsApp({
    db: env.DB,
    tenant,
    readRecord: (object, id) => getRecord(env.DB, tenant, object, id),
  });
  const request = (path: string, body: unknown) =>
    app.request(`http://localhost/api/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  const def = (
    (await (
      await request("collection-relations", {
        sourceObject: "a",
        targetObject: "b",
        sourceLabel: "B",
        targetLabel: "A",
        cardinality: "one-to-one",
      })
    ).json()) as any
  ).data;
  expect(
    (await request(`record-links/a/${a.id}/${def.id}`, { targetId: b.id }))
      .status,
  ).toBe(200);
  await deleteRecord(env.DB, tenant, "b", b.id, { version: b._version });
  expect(
    await env.DB.prepare(
      "SELECT COUNT(*) total FROM crm_record_links WHERE tenant_id=?",
    )
      .bind(tenant)
      .first(),
  ).toEqual({ total: 0 });
  expect((await getRecord(env.DB, tenant, "a", a.id)).name).toBe("A");
});

it("returns an unlinkable tombstone for an externally deleted record, but never masks forbidden reads", async () => {
  const tenant = "relations:missing";
  for (const name of ["source", "target"])
    await env.DB.prepare(
      "INSERT INTO crm_objects(tenant_id,name,label,config) VALUES(?,?,?,?)",
    )
      .bind(tenant, name, name, "{}")
      .run();
  let missing = false,
    forbidden = false;
  const app = createCollectionRelationsApp({
    db: env.DB,
    tenant,
    readRecord: async (object, id) => {
      if (object === "target" && forbidden)
        throw new HTTPException(403, { message: "Forbidden" });
      if (object === "target" && missing)
        throw new HTTPException(404, { message: "Gone" });
      return { id, name: "Record" };
    },
  });
  const request = (path: string, method = "GET", body?: unknown) =>
    app.request(`http://localhost/api/${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  const definition = (
    (await (
      await request("collection-relations", "POST", {
        sourceObject: "source",
        targetObject: "target",
        sourceLabel: "Targets",
        targetLabel: "Sources",
        cardinality: "one-to-one",
      })
    ).json()) as any
  ).data;
  const edgePath = `record-links/source/1/${definition.id}`;
  expect((await request(edgePath, "POST", { targetId: "2" })).status).toBe(200);
  missing = true;
  const response = await request("record-links/source/1");
  expect(response.status).toBe(200);
  expect(((await response.json()) as any).data[0]).toMatchObject({
    total: 1,
    canEdit: true,
    records: [{ id: "2", label: "Registro no disponible (2)", missing: true }],
  });
  forbidden = true;
  expect((await request("record-links/source/1")).status).toBe(403);
  expect((await request(edgePath, "DELETE", { targetId: "2" })).status).toBe(
    403,
  );
  forbidden = false;
  expect((await request(edgePath, "DELETE", { targetId: "2" })).status).toBe(
    200,
  );
  expect(
    ((await (await request("record-links/source/1")).json()) as any).data[0],
  ).toMatchObject({ total: 0, records: [] });
});

it("persists edited field mappings, computes both directions from current values and rejects stale or invalid edits", async () => {
  const tenant = "relations:fields";
  for (const name of ["parents", "children"])
    await env.DB.prepare(
      "INSERT INTO crm_objects(tenant_id,name,label,config) VALUES(?,?,?,?)",
    )
      .bind(
        tenant,
        name,
        name,
        JSON.stringify({
          fields: {
            code: { type: "Textbox", unique: true },
            parent: { type: "Textbox" },
            name: { type: "Textbox" },
            amount: { type: "Number" },
          },
        }),
      )
      .run();
  for (const [id, object, data] of [
    ["p", "parents", { code: "A", name: "Parent" }],
    ["c", "children", { parent: "A", name: "Child" }],
  ] as const)
    await env.DB.prepare(
      "INSERT INTO crm_records(tenant_id,id,object_name,data) VALUES(?,?,?,?)",
    )
      .bind(tenant, id, object, JSON.stringify(data))
      .run();
  const app = createCollectionRelationsApp({
    db: env.DB,
    tenant,
    readRecord: async (object, id) => {
      const r = await env.DB.prepare(
        "SELECT data FROM crm_records WHERE tenant_id=? AND object_name=? AND id=?",
      )
        .bind(tenant, object, id)
        .first<{ data: string }>();
      if (!r) throw new HTTPException(404);
      return { id, ...JSON.parse(r.data) };
    },
  });
  const req = (path: string, method = "GET", body?: unknown) =>
    app.request(`http://localhost/api/${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  const base = {
    sourceObject: "parents",
    targetObject: "children",
    sourceLabel: "Children",
    targetLabel: "Parent",
    cardinality: "one-to-many",
    storage: "fields",
    sourceField: "code",
    targetField: "parent",
    targetDisplayField: "name",
  };
  const created = await req("collection-relations", "POST", base);
  expect(created.status, await created.clone().text()).toBe(201);
  const def = ((await created.json()) as any).data;
  const groups = async (object: string, id: string) =>
    ((await (await req(`record-links/${object}/${id}`)).json()) as any).data;
  expect((await groups("parents", "p"))[0]).toMatchObject({
    total: 1,
    canEdit: false,
    records: [{ id: "c", label: "Child" }],
  });
  expect((await groups("children", "c"))[0]).toMatchObject({
    total: 1,
    records: [{ id: "p", label: "Parent" }],
  });
  await env.DB.prepare(
    "UPDATE crm_records SET data=json_set(data,'$.parent','B') WHERE tenant_id=? AND id='c'",
  )
    .bind(tenant)
    .run();
  expect((await groups("parents", "p"))[0].total).toBe(0);
  expect(
    (await req(`record-links/parents/p/${def.id}`, "POST", { targetId: "c" }))
      .status,
  ).toBe(403);
  expect(
    (
      await req(`collection-relations/${def.id}`, "PUT", {
        version: 1,
        sourceField: "name",
        cardinality: "many-to-many",
        sourceLabel: "Renamed",
      })
    ).status,
  ).toBe(200);
  const saved = ((await (await req("collection-relations")).json()) as any)
    .data[0];
  expect(saved).toMatchObject({
    sourceField: "name",
    sourceLabel: "Renamed",
    version: 2,
  });
  expect(
    (
      await req(`collection-relations/${def.id}`, "PUT", {
        version: 1,
        sourceLabel: "Stale",
      })
    ).status,
  ).toBe(409);
  expect(
    (
      await req("collection-relations", "POST", {
        ...base,
        targetField: "missing",
      })
    ).status,
  ).toBe(422);
  expect(
    (
      await req("collection-relations", "POST", {
        ...base,
        targetField: "amount",
      })
    ).status,
  ).toBe(422);
});

it("rejects cardinality narrowing and mapping changes when manual edges conflict", async () => {
  const def = await definition();
  for (const id of ["1", "2"])
    expect(
      (
        await call(`record-links/agencies_test/1/${def.id}`, "POST", {
          targetId: id,
        })
      ).status,
    ).toBe(200);
  expect(
    (
      await call(`collection-relations/${def.id}`, "PUT", {
        version: 1,
        cardinality: "one-to-one",
      })
    ).status,
  ).toBe(409);
  expect(
    (
      await call(`collection-relations/${def.id}`, "PUT", {
        version: 1,
        sourceLabel: "Edited",
      })
    ).status,
  ).toBe(200);
});

it("keeps core relations independent of legacy tables and profile bindings", async () => {
  const queries: string[] = [];
  const db = new Proxy(env.DB, {
    get(target, property) {
      if (property === "prepare")
        return (sql: string) => {
          queries.push(sql);
          if (
            /customer_clientagency|agency-network|customer-portfolio|crm_native_relation_overrides/.test(
              sql,
            )
          )
            throw new Error("Core queried legacy relation data");
          return target.prepare(sql);
        };
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const app = createCollectionRelationsApp({
    db,
    tenant: "relations:a",
    readRecord: async (_object, id) => ({ id }),
  });
  const response = await app.request("/api/record-links/agencies_test/1");
  expect(response.status).toBe(200);
  const body = (await response.json()) as {
    data: { definition: { storage: string } }[];
  };
  expect(
    body.data.every((group) => group.definition.storage !== "native"),
  ).toBe(true);
  expect(queries.some((sql) => sql.includes("crm_collection_relations"))).toBe(
    true,
  );
});
