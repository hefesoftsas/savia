import { env } from "cloudflare:workers";
import { beforeAll, expect, it } from "vitest";
import { createRecordBundlesApp } from "../src/crm/record-bundles";
import { historyDatabase } from "@savia/crm-server/record-history-storage";
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
it("captures parent/child deltas once across bundle retries and rolls back unique failures", async () => {
  const tenant = crypto.randomUUID(),
    relationId = crypto.randomUUID();
  const db = historyDatabase(env.DB, tenant, {
    kind: "user",
    id: "bundle-actor",
  });
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
            name: {
              type: "Textbox",
              label: "Name",
              required: true,
              config: { unique: true },
            },
          },
          fieldOrder: ["name"],
          studio: {
            history: { enabled: true, fields: ["name"], retentionDays: 90 },
          },
        }),
      )
      .run();
  await env.DB.prepare(
    "INSERT INTO crm_collection_relations(tenant_id,id,source_object,target_object,source_label,target_label,cardinality) VALUES(?,?,'parents','children','Children','Parent','one-to-many')",
  )
    .bind(tenant, relationId)
    .run();
  const app = createRecordBundlesApp({ db, tenant });
  const call = (body: unknown, key: string) =>
    app.request("http://test/api/record-bundles/parents", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": key },
      body: JSON.stringify(body),
    });
  const body = {
      record: { data: { name: "Parent" } },
      relations: [{ relationId, rows: [{ data: { name: "Child" } }] }],
    },
    key = crypto.randomUUID();
  const response = await call(body, key);
  expect(response.status, await response.clone().text()).toBe(200);
  const saved: any = await response.json();
  expect((await call(body, key)).status).toBe(200);
  const rows = async () =>
    (
      await env.DB.prepare(
        "SELECT * FROM crm_record_history WHERE tenant_id=? ORDER BY object_name,version",
      )
        .bind(tenant)
        .all<any>()
    ).results;
  expect(await rows()).toHaveLength(2);
  for (const row of await rows())
    expect(row).toMatchObject({
      actor_id: "bundle-actor",
      actor_kind: "user",
      version: 1,
      action: "created",
    });
  const update = {
      record: {
        id: saved.data.id,
        version: 1,
        data: { name: "Parent edited" },
      },
      relations: [
        {
          relationId,
          previousIds: [saved.related[0].records[0].id],
          rows: [
            {
              id: saved.related[0].records[0].id,
              version: 1,
              data: { name: "Child edited" },
            },
          ],
        },
      ],
    },
    updateKey = crypto.randomUUID();
  const edited = await call(update, updateKey);
  expect(edited.status, await edited.clone().text()).toBe(200);
  expect((await call(update, updateKey)).status).toBe(200);
  expect(await rows()).toHaveLength(4);
  const failed = await call(
    {
      record: { data: { name: "Would roll back" } },
      relations: [{ relationId, rows: [{ data: { name: "Child edited" } }] }],
    },
    crypto.randomUUID(),
  );
  expect(failed.status).toBe(409);
  expect(await rows()).toHaveLength(4);
  expect(
    await env.DB.prepare(
      "SELECT count(*) n FROM crm_record_history_context",
    ).first("n"),
  ).toBe(0);
});
