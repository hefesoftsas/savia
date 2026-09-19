import { WorkflowRepository } from "../src/workflows/repository";
import { processWorkflows } from "../src/workflows/runtime";
import { beforeAll, afterAll, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";
import { readFileSync, readdirSync } from "node:fs";
import { makeConfig } from "@savia/crm-shared/metadata";
import { createObject, publishSchema } from "../src/schema";
import { createRecord } from "../src/services";
import { historyDatabase } from "../src/record-history-storage";
import { createCrmApp } from "../src/index";
let platform: Awaited<
  ReturnType<typeof getPlatformProxy<{ DB: D1Database; POC_LOCAL: string }>>
>;
let db: D1Database;
const tenant = "history-mutations";
beforeAll(async () => {
  platform = await getPlatformProxy({
    configPath: "wrangler.jsonc",
    persist: false,
  });
  db = platform.env.DB;
  for (const name of readdirSync("migrations")
    .filter((n) => n.endsWith(".sql"))
    .sort())
    for (const sql of readFileSync(`migrations/${name}`, "utf8")
      .split(/;(?!(?:\s*END\b))/i)
      .filter((s) => s.trim()))
      await db.prepare(sql).run();
});
afterAll(async () => platform?.dispose());
const rows = async (id: string) =>
  (
    await db
      .prepare(
        "SELECT * FROM crm_record_history WHERE tenant_id=? AND record_id=? ORDER BY version",
      )
      .bind(tenant, id)
      .all<any>()
  ).results;
it("captures schema-publication scalar migrations in the guarded transaction", async () => {
  const config = makeConfig({ value: { type: "Textbox", label: "Value" } });
  config.studio = {
    history: { enabled: true, fields: ["value"], retentionDays: 90 },
  };
  const object = await createObject(db, tenant, {
    name: "migration",
    label: "Migration",
    config,
  });
  const actor = historyDatabase(db, tenant, {
    kind: "user",
    id: "schema-editor",
  });
  const record = await createRecord(actor, tenant, "migration", {
    value: "42",
  });
  await publishSchema(
    actor,
    tenant,
    "migration",
    {
      ...object,
      config: {
        ...object.config,
        fields: { value: { type: "Number", label: "Value" } },
      },
    },
    { coerce: ["value"] },
  );
  const history = await rows(record.id);
  expect(history).toHaveLength(2);
  expect(JSON.parse(history[1].changes)).toEqual({
    value: { before: "42", after: 42 },
  });
  expect(history[1]).toMatchObject({ version: 2, actor_id: "schema-editor" });
});
it("records offline create/update/delete retries once with the authenticated actor", async () => {
  const config = makeConfig({ name: { type: "Textbox", label: "Name" } });
  config.studio = {
    history: { enabled: true, fields: ["name"], retentionDays: 90 },
  };
  await createObject(db, tenant, { name: "offline", label: "Offline", config });
  const app = createCrmApp(tenant, { principalId: "offline-user" });
  const push = (body: unknown) =>
    app.request(
      "http://localhost/api/local-sync/push/offline",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      platform.env,
    );
  const mutations = [
    {
      mutationId: "create",
      action: "create",
      id: "offline-id",
      data: { name: "First" },
    },
    {
      mutationId: "update",
      action: "update",
      id: "offline-id",
      baseVersion: 1,
      data: { name: "Second" },
    },
    {
      mutationId: "delete",
      action: "delete",
      id: "offline-id",
      baseVersion: 2,
    },
  ];
  for (const mutation of mutations) {
    const saved = await push(mutation);
    expect(saved.status, await saved.clone().text()).toBe(200);
    expect((await push(mutation)).status).toBe(200);
  }
  const history = await rows("offline-id");
  expect(history.map((r) => r.action)).toEqual([
    "created",
    "updated",
    "deleted",
  ]);
  expect(history.map((r) => r.version)).toEqual([1, 2, 3]);
  for (const entry of history) expect(entry.actor_id).toBe("offline-user");
  expect(
    await db
      .prepare("SELECT count(*) n FROM crm_record_history_context")
      .first("n"),
  ).toBe(0);
});

it("attributes workflow native writes to the owner and execution", async () => {
  const config = makeConfig({ name: { type: "Textbox", label: "Name" } });
  config.studio = {
    history: { enabled: true, fields: ["name"], retentionDays: 90 },
  };
  await createObject(db, tenant, {
    name: "workflow_history",
    label: "Workflow",
    config,
  });
  const repo = new WorkflowRepository(db, tenant);
  const draft = await repo.create(
    {
      name: "History flow",
      definition: {
        trigger: { type: "manual", collection: "workflow_history" },
        nodes: [
          {
            id: "create",
            type: "create",
            collection: "workflow_history",
            values: { name: "Created" },
            next: "update",
          },
          {
            id: "update",
            type: "update",
            collection: "workflow_history",
            recordId: { ref: "steps.create.id" },
            values: { name: "Updated" },
          },
        ],
      },
    },
    "workflow-owner",
  );
  await repo.publish(draft.id, draft.revision, "workflow-owner");
  const execution = await repo.start(
    draft.id,
    {},
    "workflow-owner",
    "history-workflow",
  );
  await processWorkflows(db, async () => true);
  await processWorkflows(db, async () => true);
  const detail = await repo.execution(execution.id);
  expect(detail.status).toBe("completed");
  const history = await rows((detail.jobs[0].output as { id: string }).id);
  expect(history).toHaveLength(2);
  for (const entry of history)
    expect(entry).toMatchObject({
      actor_kind: "workflow",
      actor_id: "workflow-owner",
      cause_id: execution.id,
    });
});
