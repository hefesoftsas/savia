import { createTestApp } from "./test-app";
import { platformAdministratorAuthenticator } from "./auth-fixtures";
import { seedTenantAgency } from "./tenant-fixtures";
import { env } from "cloudflare:workers";
import { beforeAll, expect, it } from "vitest";
import { createRecordBundlesApp } from "../src/studio/record-bundles";
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
async function fixture(cardinality = "one-to-many", scope?: string) {
  const tenant = scope ?? crypto.randomUUID(),
    relationId = crypto.randomUUID();
  for (const name of ["parents", "children"])
    await env.DB.prepare(
      "INSERT INTO studio_objects(tenant_id,name,label,config) VALUES(?,?,?,?)",
    )
      .bind(
        tenant,
        name,
        name,
        JSON.stringify({
          fields: { name: { type: "Textbox", label: "Name", required: true } },
          fieldOrder: ["name"],
        }),
      )
      .run();
  await env.DB.prepare(
    "INSERT INTO studio_collection_relations(tenant_id,id,source_object,target_object,source_label,target_label,cardinality) VALUES(?,?,?,?,?,?,?)",
  )
    .bind(
      tenant,
      relationId,
      "parents",
      "children",
      "Children",
      "Parent",
      cardinality,
    )
    .run();
  const call = (body: unknown, key = crypto.randomUUID()) =>
    createRecordBundlesApp({ db: env.DB, tenant }).request(
      "http://test/api/record-bundles/parents",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": key },
        body: JSON.stringify(body),
      },
    );
  return { tenant, relationId, call };
}
it("atomically creates, replays and unlinks without deleting children", async () => {
  const { tenant, relationId, call } = await fixture();
  const body = {
      record: { data: { name: "Parent" } },
      relations: [{ relationId, rows: [{ data: { name: "Child" } }] }],
    },
    key = crypto.randomUUID();
  const response = await call(body, key);
  expect(response.status, await response.clone().text()).toBe(200);
  const saved: any = await response.json();
  expect(await (await call(body, key)).json()).toEqual(saved);
  expect(
    (await call({ ...body, record: { data: { name: "Different" } } }, key))
      .status,
  ).toBe(409);
  const removed = await call({
    record: { id: saved.data.id, version: 1, data: { name: "Edited" } },
    relations: [
      { relationId, previousIds: [saved.related[0].records[0].id], rows: [] },
    ],
  });
  expect(removed.status, await removed.clone().text()).toBe(200);
  expect(
    await env.DB.prepare(
      "SELECT count(*) count FROM studio_record_links WHERE tenant_id=?",
    )
      .bind(tenant)
      .first(),
  ).toEqual({ count: 0 });
  expect(
    await env.DB.prepare(
      "SELECT count(*) count FROM studio_records WHERE tenant_id=? AND object_name='children' AND deleted_at IS NULL",
    )
      .bind(tenant)
      .first(),
  ).toEqual({ count: 1 });
});
it("invalid children roll back the parent and all earlier child writes", async () => {
  const { tenant, relationId, call } = await fixture();
  const response = await call({
    record: { data: { name: "Parent" } },
    relations: [
      {
        relationId,
        rows: [{ data: { name: "Valid" } }, { data: { name: "" } }],
      },
    ],
  });
  expect(response.status).toBe(422);
  expect(await response.text()).toContain("row 2");
  expect(
    await env.DB.prepare(
      "SELECT count(*) count FROM studio_records WHERE tenant_id=?",
    )
      .bind(tenant)
      .first(),
  ).toEqual({ count: 0 });
});
it("stale child versions and foreign scoped children reject the whole bundle", async () => {
  const { relationId, call } = await fixture();
  const saved: any = await (
    await call({
      record: { data: { name: "Parent" } },
      relations: [{ relationId, rows: [{ data: { name: "Child" } }] }],
    })
  ).json();
  const response = await call({
    record: { id: saved.data.id, version: 1, data: { name: "Changed" } },
    relations: [
      {
        relationId,
        previousIds: [saved.related[0].records[0].id],
        rows: [
          {
            id: saved.related[0].records[0].id,
            version: 2,
            data: { name: "Changed" },
          },
        ],
      },
    ],
  });
  expect(response.status).toBe(409);
  const foreign = await fixture();
  expect(
    (
      await foreign.call({
        record: { data: { name: "Other" } },
        relations: [
          {
            relationId: foreign.relationId,
            rows: [{ id: saved.related[0].records[0].id }],
          },
        ],
      })
    ).status,
  ).toBe(404);
});
it("cardinality conflicts roll back every record", async () => {
  const { tenant, relationId, call } = await fixture("one-to-one");
  expect(
    (
      await call({
        record: { data: { name: "Parent" } },
        relations: [
          {
            relationId,
            rows: [{ data: { name: "A" } }, { data: { name: "B" } }],
          },
        ],
      })
    ).status,
  ).toBe(409);
  expect(
    await env.DB.prepare(
      "SELECT count(*) count FROM studio_records WHERE tenant_id=?",
    )
      .bind(tenant)
      .first(),
  ).toEqual({ count: 0 });
});
it("database cardinality and uniqueness failures leave parent and children untouched", async () => {
  const { tenant, relationId, call } = await fixture();
  const saved: any = await (
    await call({
      record: { data: { name: "First" } },
      relations: [{ relationId, rows: [{ data: { name: "Child" } }] }],
    })
  ).json();
  const child = saved.related[0].records[0];
  const denied = await call({
    record: { data: { name: "Second" } },
    relations: [{ relationId, rows: [{ id: child.id }] }],
  });
  expect(denied.status, await denied.clone().text()).toBe(409);
  expect(
    await env.DB.prepare(
      "SELECT count(*) count FROM studio_records WHERE tenant_id=?",
    )
      .bind(tenant)
      .first(),
  ).toEqual({ count: 2 });
  await env.DB.prepare(
    "UPDATE studio_objects SET config=? WHERE tenant_id=? AND name='children'",
  )
    .bind(
      JSON.stringify({
        fields: {
          name: {
            type: "Textbox",
            label: "Name",
            required: true,
            config: { unique: true },
          },
        },
        fieldOrder: ["name"],
      }),
      tenant,
    )
    .run();
  const duplicate = await call({
    record: { data: { name: "Third" } },
    relations: [
      {
        relationId,
        rows: [
          { data: { name: "Duplicate" } },
          { data: { name: "Duplicate" } },
        ],
      },
    ],
  });
  expect(duplicate.status).toBe(409);
  expect(
    await env.DB.prepare(
      "SELECT count(*) count FROM studio_records WHERE tenant_id=?",
    )
      .bind(tenant)
      .first(),
  ).toEqual({ count: 2 });
});
it("rejects stale complete selection snapshots and updates a child together with its parent", async () => {
  const { tenant, relationId, call } = await fixture();
  const saved: any = await (
    await call({
      record: { data: { name: "Parent" } },
      relations: [{ relationId, rows: [{ data: { name: "Child" } }] }],
    })
  ).json();
  const child = saved.related[0].records[0];
  expect(
    (
      await call({
        record: { id: saved.data.id, version: 1, data: {} },
        relations: [{ relationId, previousIds: [], rows: [] }],
      })
    ).status,
  ).toBe(409);
  const edited = await call({
    record: { id: saved.data.id, version: 1, data: { name: "Edited parent" } },
    relations: [
      {
        relationId,
        previousIds: [child.id],
        rows: [{ id: child.id, version: 1, data: { name: "Edited child" } }],
      },
    ],
  });
  expect(edited.status, await edited.clone().text()).toBe(200);
  const result: any = await edited.json();
  expect(result.data._version).toBe(2);
  expect(result.related[0].records[0]).toMatchObject({
    _version: 2,
    name: "Edited child",
  });
  expect(
    await env.DB.prepare(
      "SELECT count(*) count FROM studio_audit WHERE tenant_id=? AND action='record.updated'",
    )
      .bind(tenant)
      .first(),
  ).toEqual({ count: 2 });
});
it("validates required virtual relation selections and enforces server field permissions", async () => {
  const { tenant, relationId, call } = await fixture();
  const config = {
    fields: {
      name: { type: "Textbox", label: "Name", required: true },
      children: {
        type: "Dropdown",
        label: "Children",
        required: true,
        config: {
          collectionRelation: relationId,
          multiple: true,
          relationAllowCreate: false,
        },
      },
    },
    fieldOrder: ["name", "children"],
  };
  await env.DB.prepare(
    "UPDATE studio_objects SET config=? WHERE tenant_id=? AND name='parents'",
  )
    .bind(JSON.stringify(config), tenant)
    .run();
  expect(
    (await call({ record: { data: { name: "Parent" } }, relations: [] }))
      .status,
  ).toBe(422);
  expect(
    (
      await call({
        record: { data: { name: "Parent" } },
        relations: [{ relationId, rows: [{ data: { name: "Child" } }] }],
      })
    ).status,
  ).toBe(403);
  config.fields.children.config.relationAllowCreate = true;
  await env.DB.prepare(
    "UPDATE studio_objects SET config=? WHERE tenant_id=? AND name='parents'",
  )
    .bind(JSON.stringify(config), tenant)
    .run();
  const response = await call({
    record: { data: { name: "Parent" } },
    relations: [{ relationId, rows: [{ data: { name: "Child" } }] }],
  });
  expect(response.status, await response.clone().text()).toBe(200);
  const saved: any = await response.json();
  expect(saved.data).not.toHaveProperty("children");
  expect(
    (
      await call({
        record: { id: saved.data.id, version: 1, data: {} },
        relations: [
          {
            relationId,
            previousIds: [saved.related[0].records[0].id],
            rows: [],
          },
        ],
      })
    ).status,
  ).toBe(422);
});
it("guards child versions and link snapshots against changes immediately before the D1 transaction", async () => {
  const { tenant, relationId, call } = await fixture();
  const saved: any = await (
    await call({
      record: { data: { name: "Parent" } },
      relations: [{ relationId, rows: [{ data: { name: "Child" } }] }],
    })
  ).json();
  const child = saved.related[0].records[0];
  const racing = new Proxy(env.DB, {
    get(target, property) {
      if (property === "batch")
        return async (statements: D1PreparedStatement[]) => {
          await env.DB.prepare(
            "UPDATE studio_records SET version=version+1 WHERE tenant_id=? AND id=?",
          )
            .bind(tenant, child.id)
            .run();
          return target.batch(statements);
        };
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const response = await createRecordBundlesApp({ db: racing, tenant }).request(
    "http://test/api/record-bundles/parents",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": crypto.randomUUID(),
      },
      body: JSON.stringify({
        record: {
          id: saved.data.id,
          version: 1,
          data: { name: "Should roll back" },
        },
        relations: [
          {
            relationId,
            previousIds: [child.id],
            rows: [
              { id: child.id, version: 1, data: { name: "Should roll back" } },
            ],
          },
        ],
      }),
    },
  );
  expect(response.status, await response.clone().text()).toBe(409);
  expect(
    await env.DB.prepare(
      "SELECT version,data FROM studio_records WHERE tenant_id=? AND id=?",
    )
      .bind(tenant, saved.data.id)
      .first(),
  ).toEqual({ version: 1, data: JSON.stringify({ name: "Parent" }) });
  const linkRace = new Proxy(env.DB, {
    get(target, property) {
      if (property === "batch")
        return async (statements: D1PreparedStatement[]) => {
          await env.DB.prepare(
            "DELETE FROM studio_record_links WHERE tenant_id=? AND relation_id=?",
          )
            .bind(tenant, relationId)
            .run();
          return target.batch(statements);
        };
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const linkResponse = await createRecordBundlesApp({
    db: linkRace,
    tenant,
  }).request("http://test/api/record-bundles/parents", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": crypto.randomUUID(),
    },
    body: JSON.stringify({
      record: {
        id: saved.data.id,
        version: 1,
        data: { name: "Should roll back" },
      },
      relations: [
        { relationId, previousIds: [child.id], rows: [{ id: child.id }] },
      ],
    }),
  });
  expect(linkResponse.status).toBe(409);
  expect(
    await env.DB.prepare(
      "SELECT version FROM studio_records WHERE tenant_id=? AND id=?",
    )
      .bind(tenant, saved.data.id)
      .first(),
  ).toEqual({ version: 1 });
});
it("rejects disabled solutions and denied local capabilities, including replay", async () => {
  const { tenant, relationId, call } = await fixture();
  const body = {
      record: { data: { name: "Parent" } },
      relations: [{ relationId, rows: [{ data: { name: "Child" } }] }],
    },
    key = crypto.randomUUID();
  expect((await call(body, key)).status).toBe(200);
  await env.DB.prepare(
    "INSERT INTO studio_solution_installations(tenant_id,id,version,manifest,enabled) VALUES(?,'disabled','1','{}',0)",
  )
    .bind(tenant)
    .run();
  await env.DB.prepare(
    "INSERT INTO studio_solution_objects(tenant_id,solution_id,object_name,definition) VALUES(?,'disabled','children','{}')",
  )
    .bind(tenant)
    .run();
  expect((await call(body)).status).toBe(404);
  expect((await call(body, key)).status).toBe(404);
  await env.DB.prepare(
    "UPDATE studio_solution_installations SET enabled=1 WHERE tenant_id=?",
  )
    .bind(tenant)
    .run();
  await env.DB.prepare(
    "UPDATE studio_objects SET config=json_set(config,'$.studio.capabilities.create',json('false')) WHERE tenant_id=? AND name='children'",
  )
    .bind(tenant)
    .run();
  expect((await call(body)).status).toBe(403);
  expect(
    await env.DB.prepare(
      "SELECT count(*) count FROM studio_records WHERE tenant_id=?",
    )
      .bind(tenant)
      .first(),
  ).toEqual({ count: 2 });
});
it("requires idempotency and limits body and relation groups", async () => {
  const { tenant, call } = await fixture();
  const app = createRecordBundlesApp({ db: env.DB, tenant });
  expect(
    (
      await app.request("http://test/api/record-bundles/parents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          record: { data: { name: "P" } },
          relations: [],
        }),
      })
    ).status,
  ).toBe(428);
  expect(
    (
      await call({
        record: { data: { name: "x".repeat(1024 * 1024) } },
        relations: [],
      })
    ).status,
  ).toBe(413);
  expect(
    (
      await call({
        record: { data: { name: "P" } },
        relations: Array.from({ length: 11 }, (_, i) => ({
          relationId: String(i),
          rows: [],
        })),
      })
    ).status,
  ).toBe(422);
});
it("delivers automation hooks after commit and replay does not duplicate tasks", async () => {
  const { tenant, relationId, call } = await fixture();
  for (const [object, value] of [
    ["parents", "Parent"],
    ["children", "Child"],
  ])
    await env.DB.prepare(
      "INSERT INTO studio_automations(id,tenant_id,object_name,name,config,enabled) VALUES(?,?,?,?,?,1)",
    )
      .bind(
        crypto.randomUUID(),
        tenant,
        object,
        "Follow-up",
        JSON.stringify({
          field: "name",
          value,
          title: "Follow {{name}}",
          owner: "owner",
          dueDays: 1,
        }),
      )
      .run();
  const invalid = await call({
    record: { data: { name: "Parent" } },
    relations: [{ relationId, rows: [{ data: { name: "" } }] }],
  });
  expect(invalid.status).toBe(422);
  expect(
    await env.DB.prepare(
      "SELECT count(*) count FROM studio_tasks WHERE tenant_id=?",
    )
      .bind(tenant)
      .first(),
  ).toEqual({ count: 0 });
  const body = {
      record: { data: { name: "Parent" } },
      relations: [{ relationId, rows: [{ data: { name: "Child" } }] }],
    },
    key = crypto.randomUUID();
  expect((await call(body, key)).status).toBe(200);
  const committed = await env.DB.prepare(
    "SELECT response FROM studio_requests WHERE tenant_id=? AND request_key=?",
  )
    .bind(tenant, key)
    .first<{ response: string }>();
  const saved = JSON.parse(committed!.response);
  expect(saved.deliveryComplete).toBe(true);
  await env.DB.prepare(
    "UPDATE studio_automations SET version=version+1,config=json_set(config,'$.title','Changed rule') WHERE tenant_id=?",
  )
    .bind(tenant)
    .run();
  await env.DB.prepare(
    "INSERT INTO studio_automations(id,tenant_id,object_name,name,config,enabled) SELECT ?,tenant_id,object_name,name,config,enabled FROM studio_automations WHERE tenant_id=? LIMIT 1",
  )
    .bind(crypto.randomUUID(), tenant)
    .run();
  expect((await call(body, key)).status).toBe(200);
  expect(
    await env.DB.prepare(
      "SELECT count(*) count FROM studio_tasks WHERE tenant_id=?",
    )
      .bind(tenant)
      .first(),
  ).toEqual({ count: 2 });
  // Simulate an interruption after one rule succeeded: only the missing original
  // rule may be retried, even though current definitions now differ.
  const task = await env.DB.prepare(
    "SELECT id FROM studio_tasks WHERE tenant_id=? LIMIT 1",
  )
    .bind(tenant)
    .first<{ id: string }>();
  await env.DB.prepare(
    "DELETE FROM studio_automation_runs WHERE tenant_id=? AND task_id=?",
  )
    .bind(tenant, task!.id)
    .run();
  await env.DB.prepare("DELETE FROM studio_tasks WHERE tenant_id=? AND id=?")
    .bind(tenant, task!.id)
    .run();
  await env.DB.prepare(
    "UPDATE studio_requests SET response=? WHERE tenant_id=? AND request_key=?",
  )
    .bind(JSON.stringify({ ...saved, deliveryComplete: false }), tenant, key)
    .run();
  expect((await call(body, key)).status).toBe(200);
  expect(
    (
      await env.DB.prepare("SELECT title FROM studio_tasks WHERE tenant_id=?")
        .bind(tenant)
        .all<{ title: string }>()
    ).results.every((row) => row.title.startsWith("Follow ")),
  ).toBe(true);
  expect(
    await env.DB.prepare(
      "SELECT count(*) count FROM studio_tasks WHERE tenant_id=?",
    )
      .bind(tenant)
      .first(),
  ).toEqual({ count: 2 });
  expect(
    await env.DB.prepare(
      "SELECT count(*) count FROM studio_automation_runs WHERE tenant_id=? AND status='success'",
    )
      .bind(tenant)
      .first(),
  ).toEqual({ count: 2 });
});
it("saves the maximum 100-row bundle within the bounded local transaction", async () => {
  const { tenant, relationId, call } = await fixture();
  const response = await call({
    record: { data: { name: "Parent" } },
    relations: [
      {
        relationId,
        rows: Array.from({ length: 100 }, (_, index) => ({
          data: { name: `Child ${index}` },
        })),
      },
    ],
  });
  expect(response.status, await response.clone().text()).toBe(200);
  expect(
    await env.DB.prepare(
      "SELECT count(*) count FROM studio_records WHERE tenant_id=?",
    )
      .bind(tenant)
      .first(),
  ).toEqual({ count: 101 });
});
it("coalesces bundle realtime hints and versions to one per affected collection", async () => {
  const { publishRecordBundleChanges } =
    await import("../src/studio/record-bundle-realtime");
  const { tenant, relationId, call } = await fixture();
  const response = await call({
    record: { data: { name: "Parent" } },
    relations: [
      { relationId, rows: [{ data: { name: "A" } }, { data: { name: "B" } }] },
    ],
  });
  const events: unknown[] = [];
  await publishRecordBundleChanges({
    db: env.DB,
    tenant,
    room: "platform",
    actor: "actor",
    object: "parents",
    response,
    hub: {
      publish: (room: string, event: unknown) => events.push({ room, event }),
    } as any,
  });
  expect(events).toHaveLength(2);
  expect(events).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        room: "platform",
        event: expect.objectContaining({
          collection: "parents",
          topic: "records",
          type: "updated",
          version: 1,
        }),
      }),
      expect.objectContaining({
        event: expect.objectContaining({ collection: "children", version: 1 }),
      }),
    ]),
  );
  expect(await response.json()).toHaveProperty("data");
});

it("publishes bounded hints from tenant and platform bundle routes only after success", async () => {
  await seedTenantAgency(env.DB, 101);
  for (const [tenant, prefix, room] of [
    ["agency:101", "/v1/dynamic-crm/101/api", "tenant:101"],
    ["domain:platform", "/v1/data-domains/platform/api", "platform"],
  ]) {
    const { relationId } = await fixture("one-to-many", tenant);
    const events: { room: string; event: unknown }[] = [];
    const app = createTestApp({
      documents: env.DOCUMENTS,
      auth: platformAdministratorAuthenticator(),
      realtime: {
        publish: (room, event) => {
          events.push({ room, event });
        },
      } as any,
    });
    const request = (name: string, principal?: string) =>
      app.request(prefix + "/record-bundles/parents", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
          ...(principal !== undefined
            ? { "X-Savia-Sync-Principal": principal }
            : {}),
        },
        body: JSON.stringify({
          record: { data: { name } },
          relations: [{ relationId, rows: [{ data: { name: "Child" } }] }],
        }),
      });
    expect((await request("Wrong principal", "other-user")).status).toBe(403);
    expect(events).toHaveLength(0);
    const invalid = await request("");
    expect(invalid.status).toBe(422);
    expect(events).toHaveLength(0);
    const response = await request("Parent");
    expect(response.status, await response.clone().text()).toBe(200);
    expect(events).toHaveLength(2);
    expect(events.map((item) => item.room)).toEqual([room, room]);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: expect.objectContaining({
            collection: "children",
            type: "updated",
            version: 1,
          }),
        }),
      ]),
    );
    const saved: any = await response.json();
    expect(saved).toHaveProperty("related");
    for (const path of [
      `/records/parents/${saved.data.id}`,
      `/record-links/parents/${saved.data.id}`,
    ]) {
      const denied = await app.request(prefix + path, {
        headers: { "X-Savia-Sync-Principal": "other-user" },
      });
      expect(denied.status).toBe(403);
      expect(await denied.json()).not.toHaveProperty("data");
      const allowed = await app.request(prefix + path, {
        headers: { "X-Savia-Sync-Principal": "test-platform-admin" },
      });
      expect(allowed.status).toBe(200);
    }
  }
});

it("preserves offline create IDs and replays the original receipt after later edits", async () => {
  const { relationId, call } = await fixture();
  const parentId = crypto.randomUUID(),
    childId = crypto.randomUUID(),
    key = crypto.randomUUID();
  const body = {
    record: { clientId: parentId, data: { name: "Parent" } },
    relations: [
      { relationId, rows: [{ clientId: childId, data: { name: "Child" } }] },
    ],
  };
  const response = await call(body, key);
  expect(response.status).toBe(200);
  const saved: any = await response.json();
  expect(saved.data.id).toBe(parentId);
  expect(saved.related[0].records[0].id).toBe(childId);
  expect(
    (
      await call({
        record: { id: parentId, version: 1, data: { name: "Later" } },
        relations: [],
      })
    ).status,
  ).toBe(200);
  expect(await (await call(body, key)).json()).toEqual(saved);
  expect((await call(body)).status).toBe(409);
});
it("rejects malformed or edit/link client IDs without writing any records", async () => {
  const { tenant, relationId, call } = await fixture();
  for (const row of [
    { clientId: "bad", data: { name: "Child" } },
    {
      clientId: crypto.randomUUID(),
      id: crypto.randomUUID(),
      data: { name: "Child" },
    },
    { clientId: crypto.randomUUID(), version: 1, data: { name: "Child" } },
    { clientId: crypto.randomUUID() },
  ]) {
    expect(
      (
        await call({
          record: { data: { name: "Parent" } },
          relations: [{ relationId, rows: [row] }],
        })
      ).status,
    ).toBe(422);
  }
  expect(
    await env.DB.prepare(
      "SELECT count(*) count FROM studio_records WHERE tenant_id=?",
    )
      .bind(tenant)
      .first(),
  ).toEqual({ count: 0 });
});

it("rolls back a parent when a child create ID collides, including deleted records", async () => {
  const { tenant, relationId, call } = await fixture();
  const childId = crypto.randomUUID();
  const original = await call({
    record: { data: { name: "Original" } },
    relations: [
      { relationId, rows: [{ clientId: childId, data: { name: "Child" } }] },
    ],
  });
  expect(original.status).toBe(200);
  for (const deleted of [false, true]) {
    if (deleted)
      await env.DB.prepare(
        "UPDATE studio_records SET deleted_at='2026-09-19' WHERE tenant_id=? AND id=?",
      )
        .bind(tenant, childId)
        .run();
    const response = await call({
      record: { clientId: crypto.randomUUID(), data: { name: "Uncommitted" } },
      relations: [
        {
          relationId,
          rows: [{ clientId: childId, data: { name: "Overwrite" } }],
        },
      ],
    });
    expect(response.status).toBe(409);
    expect(
      await env.DB.prepare(
        "SELECT count(*) count FROM studio_records WHERE tenant_id=?",
      )
        .bind(tenant)
        .first(),
    ).toEqual({ count: 2 });
    expect(
      await env.DB.prepare(
        "SELECT json_extract(data,'$.name') name FROM studio_records WHERE tenant_id=? AND id=?",
      )
        .bind(tenant, childId)
        .first(),
    ).toEqual({ name: "Child" });
  }
});

it("enforces scoped bundle row and field grants and projects immutable replays", async () => {
  const { accessDatabase } =
    await import("@savia/studio-server/access-authorization");
  const { tenant, relationId } = await fixture();
  const scope = `domain:${tenant}` as const;
  await env.DB.prepare(
    "INSERT INTO access_revisions(scope,revision) VALUES (?,1)",
  )
    .bind(scope)
    .run();
  const policy = {
    principalId: "bundle-owner",
    scope,
    revision: 1,
    grants: ["parents", "children"].flatMap((name) =>
      (["read", "create", "update"] as const).map((action) => ({
        id: `${name}-${action}`,
        roleId: "form-owner",
        resource: `collection:${name}` as const,
        action,
        predicate: { all: true as const },
        fields: ["name"],
      })),
    ),
  };
  const call = (
    input: unknown,
    grants = policy.grants,
    key = crypto.randomUUID(),
    revision = 1,
  ) =>
    createRecordBundlesApp({
      db: accessDatabase(env.DB, { ...policy, grants, revision }),
      tenant,
    }).request("http://test/api/record-bundles/parents", {
      method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": key },
      body: JSON.stringify(input),
    });
  const body = {
    record: { clientId: crypto.randomUUID(), data: { name: "Parent" } },
    relations: [
      {
        relationId,
        rows: [{ clientId: crypto.randomUUID(), data: { name: "Child" } }],
      },
    ],
  };
  expect(
    (
      await call(
        body,
        policy.grants.filter((g) => g.resource !== "collection:children"),
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await call(
        body,
        policy.grants.map((g) => ({
          ...g,
          fields: g.action === "create" ? [] : g.fields,
        })),
      )
    ).status,
  ).toBe(403);
  const key = crypto.randomUUID();
  const response = await call(body, policy.grants, key);
  expect(response.status, await response.clone().text()).toBe(200);
  const saved: any = await response.json();
  const { createCollectionGateway } =
    await import("../src/studio/collection-gateway");
  const actor = await platformAdministratorAuthenticator().authenticate(
    new Request("http://test"),
    env.DB,
  );
  const gateway = (grants = policy.grants) =>
    createCollectionGateway({
      db: env.DB,
      files: env.DOCUMENTS,
      tenant,
      actor,
      accessPolicy: { ...policy, grants },
      seedObjects: [],
    });
  const replay = await gateway().fetch(
    new Request("http://test/api/record-bundles/parents", {
      method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": key },
      body: JSON.stringify(body),
    }),
  );
  const staleHeaders = new Request("http://test/api/record-bundles/parents", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "Idempotency-Key": key,
      "X-Savia-Policy-Revision": "0",
    },
    body: JSON.stringify(body),
  });
  expect((await gateway().fetch(staleHeaders)).status).toBe(403);
  const metadata = await gateway().fetch(
    new Request("http://test/api/collection-relations"),
  );
  expect(metadata.status).toBe(200);
  expect(((await metadata.json()) as any).data.map((d: any) => d.id)).toContain(
    relationId,
  );
  const deniedMetadata = await gateway(
    policy.grants.filter((g) => g.resource !== "collection:children"),
  ).fetch(new Request("http://test/api/collection-relations"));
  expect(((await deniedMetadata.json()) as any).data).toEqual([]);
  expect(replay.status).toBe(200);
  expect(await replay.json()).toEqual(saved);
  const linkRequest = () =>
    new Request(
      `http://test/api/record-links/parents/${saved.data.id}?includeRecords=true`,
    );
  const links = await gateway().fetch(linkRequest());
  expect(links.status, await links.clone().text()).toBe(200);
  expect(((await links.json()) as any).data[0].records[0].data.name).toBe(
    "Child",
  );
  const hidden = await gateway(
    policy.grants.map((g) => ({
      ...g,
      fields: g.action === "read" ? [] : g.fields,
    })),
  ).fetch(linkRequest());
  expect(hidden.status).toBe(200);
  expect(
    ((await hidden.json()) as any).data[0].records[0].data,
  ).not.toHaveProperty("name");
  expect(
    (
      await gateway(
        policy.grants.filter((g) => g.resource !== "collection:children"),
      ).fetch(linkRequest())
    ).status,
  ).toBe(403);
  expect(saved.data.name).toBe("Parent");
  expect(
    await env.DB.prepare(
      "SELECT created_by FROM studio_records WHERE tenant_id=? AND id=?",
    )
      .bind(tenant, saved.data.id)
      .first(),
  ).toEqual({ created_by: "bundle-owner" });
  const projected: any = await (
    await call(
      body,
      policy.grants.map((g) => ({
        ...g,
        fields: g.action === "read" ? [] : g.fields,
      })),
      key,
    )
  ).json();
  expect(projected.data).not.toHaveProperty("name");
  expect(projected.related[0].records[0]).not.toHaveProperty("name");
  const deniedRows = policy.grants.map((g) => ({
    ...g,
    predicate: {
      field: "name",
      op: "eq" as const,
      value: { literal: "Unrelated" },
    },
  }));
  expect(
    (await call(body, deniedRows as typeof policy.grants, key)).status,
  ).toBe(403);
  expect(
    (
      await call(
        {
          ...body,
          record: { id: saved.data.id, version: 1, data: { name: "Changed" } },
        },
        deniedRows as typeof policy.grants,
      )
    ).status,
  ).toBe(403);
  const unrelatedRelation = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO studio_collection_relations(tenant_id,id,source_object,target_object,source_label,target_label,cardinality,storage) VALUES(?,?,?,?,?,?,?,?)",
  )
    .bind(
      tenant,
      unrelatedRelation,
      "parents",
      "children",
      "Other",
      "Other",
      "many-to-many",
      "fields",
    )
    .run();
  expect(
    (
      await gateway().fetch(
        new Request(
          `http://test/api/record-links/parents/${saved.data.id}?relationId=${relationId}&direction=outgoing`,
        ),
      )
    ).status,
  ).toBe(200);
  expect((await gateway().fetch(linkRequest())).status).toBe(403);
  await env.DB.prepare("UPDATE access_revisions SET revision=2 WHERE scope=?")
    .bind(scope)
    .run();
  const stale = {
    record: { clientId: crypto.randomUUID(), data: { name: "Stale" } },
    relations: [],
  };
  expect((await call(stale)).status).toBe(409);
  expect(
    await env.DB.prepare(
      "SELECT count(*) n FROM studio_records WHERE tenant_id=?",
    )
      .bind(tenant)
      .first(),
  ).toEqual({ n: 2 });
});

it("journals each committed bundle member once without duplicating workflow events on replay", async () => {
  const { tenant, relationId, call } = await fixture();
  for (const collection of ["parents", "children"]) {
    const definition = JSON.stringify({
      trigger: { type: "created", collection },
      nodes: [{ id: "start", type: "finish" }],
    });
    await env.DB.prepare(
      "INSERT INTO workflows(workspace_id,id,name,definition,created_by) VALUES(?,?,?,?,?)",
    )
      .bind(tenant, collection, collection, definition, "owner")
      .run();
    await env.DB.prepare(
      "INSERT INTO workflow_versions(workspace_id,id,workflow_id,definition,owner_id,revision) VALUES(?,?,?,?,?,1)",
    )
      .bind(tenant, collection + "-v1", collection, definition, "owner")
      .run();
    await env.DB.prepare(
      "UPDATE workflows SET enabled=1,published_version=? WHERE workspace_id=? AND id=?",
    )
      .bind(collection + "-v1", tenant, collection)
      .run();
  }
  const input = {
      record: { clientId: crypto.randomUUID(), data: { name: "Parent" } },
      relations: [
        {
          relationId,
          rows: [{ clientId: crypto.randomUUID(), data: { name: "Child" } }],
        },
      ],
    },
    key = crypto.randomUUID();
  expect((await call(input, key)).status).toBe(200);
  expect((await call(input, key)).status).toBe(200);
  expect((await call(input)).status).toBe(409);
  for (const table of [
    "studio_records",
    "workflow_events",
    "workflow_executions",
  ])
    expect(
      await env.DB.prepare(
        `SELECT count(*) n FROM ${table} WHERE ${table === "studio_records" ? "tenant_id" : "workspace_id"}=?`,
      )
        .bind(tenant)
        .first(),
    ).toEqual({ n: 2 });
});
