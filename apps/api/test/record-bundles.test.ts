import { createTestApp } from "./test-app";
import { platformAdministratorAuthenticator } from "./auth-fixtures";
import { seedTenantAgency } from "./tenant-fixtures";
import { env } from "cloudflare:workers";
import { beforeAll, expect, it } from "vitest";
import { createRecordBundlesApp } from "../src/crm/record-bundles";
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
      "INSERT INTO crm_objects(tenant_id,name,label,config) VALUES(?,?,?,?)",
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
    "INSERT INTO crm_collection_relations(tenant_id,id,source_object,target_object,source_label,target_label,cardinality) VALUES(?,?,?,?,?,?,?)",
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
      "SELECT count(*) count FROM crm_record_links WHERE tenant_id=?",
    )
      .bind(tenant)
      .first(),
  ).toEqual({ count: 0 });
  expect(
    await env.DB.prepare(
      "SELECT count(*) count FROM crm_records WHERE tenant_id=? AND object_name='children' AND deleted_at IS NULL",
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
      "SELECT count(*) count FROM crm_records WHERE tenant_id=?",
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
      "SELECT count(*) count FROM crm_records WHERE tenant_id=?",
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
      "SELECT count(*) count FROM crm_records WHERE tenant_id=?",
    )
      .bind(tenant)
      .first(),
  ).toEqual({ count: 2 });
  await env.DB.prepare(
    "UPDATE crm_objects SET config=? WHERE tenant_id=? AND name='children'",
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
      "SELECT count(*) count FROM crm_records WHERE tenant_id=?",
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
      "SELECT count(*) count FROM crm_audit WHERE tenant_id=? AND action='record.updated'",
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
    "UPDATE crm_objects SET config=? WHERE tenant_id=? AND name='parents'",
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
    "UPDATE crm_objects SET config=? WHERE tenant_id=? AND name='parents'",
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
            "UPDATE crm_records SET version=version+1 WHERE tenant_id=? AND id=?",
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
      "SELECT version,data FROM crm_records WHERE tenant_id=? AND id=?",
    )
      .bind(tenant, saved.data.id)
      .first(),
  ).toEqual({ version: 1, data: JSON.stringify({ name: "Parent" }) });
  const linkRace = new Proxy(env.DB, {
    get(target, property) {
      if (property === "batch")
        return async (statements: D1PreparedStatement[]) => {
          await env.DB.prepare(
            "DELETE FROM crm_record_links WHERE tenant_id=? AND relation_id=?",
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
      "SELECT version FROM crm_records WHERE tenant_id=? AND id=?",
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
    "INSERT INTO crm_solution_installations(tenant_id,id,version,manifest,enabled) VALUES(?,'disabled','1','{}',0)",
  )
    .bind(tenant)
    .run();
  await env.DB.prepare(
    "INSERT INTO crm_solution_objects(tenant_id,solution_id,object_name,definition) VALUES(?,'disabled','children','{}')",
  )
    .bind(tenant)
    .run();
  expect((await call(body)).status).toBe(404);
  expect((await call(body, key)).status).toBe(404);
  await env.DB.prepare(
    "UPDATE crm_solution_installations SET enabled=1 WHERE tenant_id=?",
  )
    .bind(tenant)
    .run();
  await env.DB.prepare(
    "UPDATE crm_objects SET config=json_set(config,'$.studio.capabilities.create',json('false')) WHERE tenant_id=? AND name='children'",
  )
    .bind(tenant)
    .run();
  expect((await call(body)).status).toBe(403);
  expect(
    await env.DB.prepare(
      "SELECT count(*) count FROM crm_records WHERE tenant_id=?",
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
      "INSERT INTO crm_automations(id,tenant_id,object_name,name,config,enabled) VALUES(?,?,?,?,?,1)",
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
      "SELECT count(*) count FROM crm_tasks WHERE tenant_id=?",
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
    "SELECT response FROM crm_requests WHERE tenant_id=? AND request_key=?",
  )
    .bind(tenant, key)
    .first<{ response: string }>();
  const saved = JSON.parse(committed!.response);
  expect(saved.deliveryComplete).toBe(true);
  await env.DB.prepare(
    "UPDATE crm_automations SET version=version+1,config=json_set(config,'$.title','Changed rule') WHERE tenant_id=?",
  )
    .bind(tenant)
    .run();
  await env.DB.prepare(
    "INSERT INTO crm_automations(id,tenant_id,object_name,name,config,enabled) SELECT ?,tenant_id,object_name,name,config,enabled FROM crm_automations WHERE tenant_id=? LIMIT 1",
  )
    .bind(crypto.randomUUID(), tenant)
    .run();
  expect((await call(body, key)).status).toBe(200);
  expect(
    await env.DB.prepare(
      "SELECT count(*) count FROM crm_tasks WHERE tenant_id=?",
    )
      .bind(tenant)
      .first(),
  ).toEqual({ count: 2 });
  // Simulate an interruption after one rule succeeded: only the missing original
  // rule may be retried, even though current definitions now differ.
  const task = await env.DB.prepare(
    "SELECT id FROM crm_tasks WHERE tenant_id=? LIMIT 1",
  )
    .bind(tenant)
    .first<{ id: string }>();
  await env.DB.prepare(
    "DELETE FROM crm_automation_runs WHERE tenant_id=? AND task_id=?",
  )
    .bind(tenant, task!.id)
    .run();
  await env.DB.prepare("DELETE FROM crm_tasks WHERE tenant_id=? AND id=?")
    .bind(tenant, task!.id)
    .run();
  await env.DB.prepare(
    "UPDATE crm_requests SET response=? WHERE tenant_id=? AND request_key=?",
  )
    .bind(JSON.stringify({ ...saved, deliveryComplete: false }), tenant, key)
    .run();
  expect((await call(body, key)).status).toBe(200);
  expect(
    (
      await env.DB.prepare("SELECT title FROM crm_tasks WHERE tenant_id=?")
        .bind(tenant)
        .all<{ title: string }>()
    ).results.every((row) => row.title.startsWith("Follow ")),
  ).toBe(true);
  expect(
    await env.DB.prepare(
      "SELECT count(*) count FROM crm_tasks WHERE tenant_id=?",
    )
      .bind(tenant)
      .first(),
  ).toEqual({ count: 2 });
  expect(
    await env.DB.prepare(
      "SELECT count(*) count FROM crm_automation_runs WHERE tenant_id=? AND status='success'",
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
      "SELECT count(*) count FROM crm_records WHERE tenant_id=?",
    )
      .bind(tenant)
      .first(),
  ).toEqual({ count: 101 });
});
it("coalesces bundle realtime hints and versions to one per affected collection", async () => {
  const { publishRecordBundleChanges } =
    await import("../src/crm/record-bundle-realtime");
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
    const request = (name: string) =>
      app.request(prefix + "/record-bundles/parents", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          record: { data: { name } },
          relations: [{ relationId, rows: [{ data: { name: "Child" } }] }],
        }),
      });
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
    expect(await response.json()).toHaveProperty("related");
  }
});
