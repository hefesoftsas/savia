import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { getPlatformProxy } from "wrangler";
import { readFileSync, readdirSync } from "node:fs";
import { makeConfig } from "@savia/crm-shared/metadata";
import {
  createRecord,
  updateRecord,
  getRecord,
  deleteRecord,
  restoreRecord,
} from "../src/services";
import { WorkflowRepository } from "../src/workflows/repository";
import { processWorkflows } from "../src/workflows/runtime";
import type { WorkflowDefinition } from "@savia/crm-shared/workflows";
import { createCrmApp } from "../src/index";
let platform: Awaited<ReturnType<typeof getPlatformProxy<{ DB: D1Database }>>>;
let db: D1Database;
const tenant = "domain:general",
  owner = "user-general";
let serial = 0;
async function published(definition: WorkflowDefinition) {
  const repo = new WorkflowRepository(db, tenant);
  const draft = await repo.create(
    { name: `Flow ${++serial}`, definition },
    owner,
  );
  await repo.publish(draft.id, draft.revision, owner);
  return { repo, id: draft.id };
}
const manual = (nodes: WorkflowDefinition["nodes"]): WorkflowDefinition => ({
  trigger: { type: "manual", collection: "requests" },
  nodes,
});
const valueFlow = (value: string): WorkflowDefinition =>
  manual([{ id: "value", type: "transform", values: { result: value } }]);
beforeAll(async () => {
  platform = await getPlatformProxy({
    configPath: "wrangler.jsonc",
    persist: false,
  });
  db = platform.env.DB;
  for (const name of readdirSync("migrations")
    .filter((n) => n.endsWith(".sql"))
    .sort()) {
    for (const sql of readFileSync(`migrations/${name}`, "utf8")
      .split(/;(?!(?:\s*END\b))/i)
      .filter((s) => s.trim()))
      await db.prepare(sql).run();
  }
  for (const scope of [tenant, "domain:other"]) {
    await db
      .prepare(
        "INSERT INTO crm_objects(tenant_id,name,label,config) VALUES (?,?,?,?)",
      )
      .bind(
        scope,
        "requests",
        "Requests",
        JSON.stringify(
          makeConfig({
            title: { type: "Textbox", label: "Title" },
            amount: { type: "Number", label: "Amount" },
            status: { type: "Textbox", label: "Status" },
          }),
        ),
      )
      .run();
  }
});
afterAll(async () => platform?.dispose());
describe("general workflows on real D1", () => {
  it("filters combined events before creating executions and preserves snapshots", async () => {
    const { repo, id } = await published({
      trigger: {
        type: "created_or_updated",
        collection: "requests",
        changedFields: ["status"],
        conditions: [{ field: "status", operator: "eq", value: "approved" }],
      },
      nodes: [
        {
          id: "copy",
          type: "transform",
          values: { status: { ref: "trigger.status" } },
        },
      ],
    });
    const record = await createRecord(db, tenant, "requests", {
      title: "Filtered",
      status: "new",
    });
    expect(await repo.executions(id)).toHaveLength(0);
    await updateRecord(
      db,
      tenant,
      "requests",
      record.id,
      { status: "approved" },
      { version: 1 },
    );
    await updateRecord(
      db,
      tenant,
      "requests",
      record.id,
      { title: "Unwatched" },
      { version: 2 },
    );
    await createRecord(db, tenant, "requests", { status: "approved" });
    await createRecord(db, "domain:other", "requests", { status: "approved" });
    const runs = await repo.executions(id);
    expect(runs).toHaveLength(2);
    const contexts = await Promise.all(
      runs.map(async (run) => (await repo.execution(run.id)).context),
    );
    expect(contexts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          before: expect.objectContaining({ status: "new" }),
          trigger: expect.objectContaining({ status: "approved" }),
          system: expect.objectContaining({ eventType: "updated" }),
        }),
      ]),
    );
    await repo.setEnabled(id, false);
  });
  it("dispatches deletion once with the removed record, including hard deletion", async () => {
    const { repo, id } = await published({
      trigger: {
        type: "deleted",
        collection: "requests",
        conditions: [{ field: "status", operator: "eq", value: "approved" }],
      },
      nodes: [
        {
          id: "copy",
          type: "transform",
          values: {
            title: { ref: "trigger.title" },
            previous: { ref: "before.status" },
          },
        },
      ],
    });
    const record = await createRecord(db, tenant, "requests", {
      title: "Removed",
      status: "approved",
    });
    await deleteRecord(db, tenant, "requests", record.id, { version: 1 });
    expect(await repo.executions(id)).toHaveLength(1);
    await db
      .prepare("DELETE FROM crm_records WHERE tenant_id=? AND id=?")
      .bind(tenant, record.id)
      .run();
    expect(await repo.executions(id)).toHaveLength(1);
    await processWorkflows(db, async () => true);
    const run = await repo.execution((await repo.executions(id))[0].id);
    expect(run.status).toBe("completed");
    expect(run.jobs[0].output).toEqual({
      title: "Removed",
      previous: "approved",
    });
    const hard = await createRecord(db, tenant, "requests", {
      title: "Hard",
      status: "approved",
    });
    await db
      .prepare("DELETE FROM crm_records WHERE tenant_id=? AND id=?")
      .bind(tenant, hard.id)
      .run();
    expect(await repo.executions(id)).toHaveLength(2);
    await repo.setEnabled(id, false);
  });
  it("rejects filter fields that do not belong to the trigger collection", async () => {
    await expect(
      published({
        trigger: {
          type: "created",
          collection: "requests",
          conditions: [{ field: "missing", operator: "eq", value: "x" }],
        },
        nodes: [{ id: "done", type: "transform", values: {} }],
      }),
    ).rejects.toThrow("Unknown field");
  });
  it("compares typed scalar filters without coercing missing, null, false or zero", async () => {
    const cases = [
      {
        operator: "eq",
        value: null,
        yes: [null],
        no: [undefined, "", false, 0],
      },
      {
        operator: "eq",
        value: false,
        yes: [false],
        no: [0, "false", undefined],
      },
      {
        operator: "neq",
        value: 0,
        yes: [false, "0", 1, null],
        no: [0, undefined],
      },
      { operator: "gt", value: 2, yes: [3], no: [2, "3", true, null] },
      { operator: "gte", value: 2, yes: [2, 3], no: [1, "3", null] },
      { operator: "lt", value: 2, yes: [1], no: [2, "1", false, null] },
      { operator: "lte", value: 2, yes: [1, 2], no: [3, "1", null] },
      {
        operator: "contains",
        value: "app",
        yes: ["approved"],
        no: ["APPROVED", 1, null],
      },
      {
        operator: "empty",
        value: null,
        yes: [undefined, null, ""],
        no: [false, 0, " "],
      },
      {
        operator: "not_empty",
        value: null,
        yes: [false, 0, " "],
        no: [undefined, null, ""],
      },
    ] as const;
    for (const test of cases) {
      const { repo, id } = await published({
        trigger: {
          type: "created",
          collection: "requests",
          conditions: [
            { field: "amount", operator: test.operator, value: test.value },
          ],
        },
        nodes: [{ id: "done", type: "transform", values: {} }],
      });
      for (const value of [...test.yes, ...test.no]) {
        await db
          .prepare(
            "INSERT INTO crm_records(tenant_id,object_name,id,data) VALUES (?,?,?,?)",
          )
          .bind(
            tenant,
            "requests",
            crypto.randomUUID(),
            JSON.stringify({ amount: value }),
          )
          .run();
      }
      expect((await repo.executions(id)).length, test.operator).toBe(
        test.yes.length,
      );
      await repo.setEnabled(id, false);
    }
  });
  it("combines filters with all or any and treats no conditions as unfiltered", async () => {
    for (const conditionMode of ["all", "any"] as const) {
      const { repo, id } = await published({
        trigger: {
          type: "created",
          collection: "requests",
          conditionMode,
          conditions: [
            { field: "status", operator: "eq", value: "approved" },
            { field: "amount", operator: "gte", value: 10 },
          ],
        },
        nodes: [{ id: "done", type: "transform", values: {} }],
      });
      await createRecord(db, tenant, "requests", {
        status: "approved",
        amount: 1,
      });
      await createRecord(db, tenant, "requests", { status: "new", amount: 10 });
      await createRecord(db, tenant, "requests", {
        status: "approved",
        amount: 10,
      });
      await createRecord(db, tenant, "requests", { status: "new", amount: 1 });
      expect(await repo.executions(id)).toHaveLength(
        conditionMode === "all" ? 1 : 3,
      );
      await repo.setEnabled(id, false);
    }
    const { repo, id } = await published({
      trigger: {
        type: "created",
        collection: "requests",
        conditionMode: "any",
        conditions: [],
      },
      nodes: [{ id: "done", type: "transform", values: {} }],
    });
    await createRecord(db, tenant, "requests", { title: "Unfiltered" });
    expect(await repo.executions(id)).toHaveLength(1);
    await repo.setEnabled(id, false);
  });
  it("does not dispatch on restoration and rolls back failed deletion transactions", async () => {
    const { repo, id } = await published({
      trigger: { type: "deleted", collection: "requests" },
      nodes: [{ id: "done", type: "transform", values: {} }],
    });
    const record = await createRecord(db, tenant, "requests", {
      title: "Restorable",
    });
    await deleteRecord(db, tenant, "requests", record.id, { version: 1 });
    await restoreRecord(db, tenant, "requests", record.id, 2);
    expect(await repo.executions(id)).toHaveLength(1);
    await expect(
      db.batch([
        db
          .prepare(
            "UPDATE crm_records SET deleted_at='now' WHERE tenant_id=? AND id=?",
          )
          .bind(tenant, record.id),
        db
          .prepare(
            "INSERT INTO workflows(workspace_id,id,name,definition,created_by) VALUES (?,?,?,?,?)",
          )
          .bind(tenant, "invalid", "Invalid", "invalid json", owner),
      ]),
    ).rejects.toThrow();
    expect(await repo.executions(id)).toHaveLength(1);
    expect(
      (await getRecord(db, tenant, "requests", record.id)).deleted_at,
    ).toBeNull();
    await deleteRecord(db, tenant, "requests", record.id, { version: 3 });
    expect(await repo.executions(id)).toHaveLength(2);
    await repo.setEnabled(id, false);
  });
  it("fences a worker cancelled after authorization and before a native write", async () => {
    const { repo, id } = await published(
      manual([
        {
          id: "write",
          type: "create",
          collection: "requests",
          values: { title: "Must not be written" },
        },
      ]),
    );
    const run = await repo.start(id, {}, owner, "cancel-before-write");
    await processWorkflows(db, async () => {
      await repo.cancel(run.id);
      return true;
    });
    expect((await repo.execution(run.id)).status).toBe("cancelled");
    expect(
      (
        await db
          .prepare(
            "SELECT count(*) n FROM crm_records WHERE tenant_id=? AND json_extract(data,'$.title')='Must not be written'",
          )
          .bind(tenant)
          .first<{ n: number }>()
      )?.n,
    ).toBe(0);
  });
  it("bounds automatic retries and allows explicit retry of only the failed step", async () => {
    const { repo, id } = await published(
      manual([
        {
          id: "missing",
          type: "transform",
          values: { value: { ref: "trigger.missing" } },
        },
      ]),
    );
    const run = await repo.start(id, {}, owner, "missing-variable");
    const now = Date.now();
    for (let tick = 0; tick < 3; tick++)
      await processWorkflows(db, async () => true, { now: now + tick * 60000 });
    expect((await repo.execution(run.id)).status).toBe("failed");
    await repo.retry(run.id);
    expect((await repo.execution(run.id)).status).toBe("queued");
    await repo.cancel(run.id);
  });
  it("bounds causation when a workflow writes to its own trigger collection", async () => {
    const { repo, id } = await published({
      trigger: { type: "created", collection: "requests" },
      nodes: [
        {
          id: "again",
          type: "create",
          collection: "requests",
          values: { title: "Causal chain" },
        },
      ],
    });
    await createRecord(db, tenant, "requests", { title: "Chain start" });
    await processWorkflows(db, async () => true);
    expect(await repo.executions(id)).toHaveLength(5);
    await repo.setEnabled(id, false);
  });
  it("publishes the same revision idempotently and rejects stale edits", async () => {
    const { repo, id } = await published(valueFlow("stable"));
    const draft = await repo.get(id);
    expect(
      (await repo.publish(id, draft.revision, owner)).published_version,
    ).toBe(draft.published_version);
    await repo.save(id, draft.revision, {
      name: "Changed",
      definition: valueFlow("new"),
    });
    await expect(
      repo.save(id, draft.revision, {
        name: "Stale",
        definition: valueFlow("old"),
      }),
    ).rejects.toThrow();
  });
  it("resumes from the committed checkpoint in a new processor invocation", async () => {
    const { repo, id } = await published(
      manual([
        {
          id: "create",
          type: "create",
          collection: "requests",
          values: { title: "Restart checkpoint" },
          next: "done",
        },
        {
          id: "done",
          type: "transform",
          values: { record: { ref: "steps.create.id" } },
        },
      ]),
    );
    const run = await repo.start(id, {}, owner, "restart");
    await processWorkflows(db, async () => true, { maxSteps: 1 });
    expect((await repo.execution(run.id)).jobs).toHaveLength(1);
    await processWorkflows(db, async () => true);
    const detail = await repo.execution(run.id);
    expect(detail.status).toBe("completed");
    expect(detail.jobs).toHaveLength(2);
    expect(detail.jobs[1].output.record).toBe(detail.jobs[0].output.id);
    expect(
      (
        await db
          .prepare(
            "SELECT count(*) n FROM crm_records WHERE tenant_id=? AND json_extract(data,'$.title')='Restart checkpoint'",
          )
          .bind(tenant)
          .first<{ n: number }>()
      )?.n,
    ).toBe(1);
  });
  it("denies workflow access without explicit host authorization and distinguishes actions", async () => {
    const denied = createCrmApp(tenant, { principalId: owner });
    expect(
      (await denied.request("/api/workflows", {}, { DB: db })).status,
    ).toBe(403);
    const app = createCrmApp(tenant, {
      principalId: owner,
      authorizeWorkflow: async ({ action }) => action === "view",
    });
    expect((await app.request("/api/workflows", {}, { DB: db })).status).toBe(
      200,
    );
    expect(
      (
        await app.request(
          "/api/workflows",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              name: "Forbidden",
              definition: valueFlow("x"),
            }),
          },
          { DB: db },
        )
      ).status,
    ).toBe(403);
  });
  it("pins a published version and deduplicates manual delivery", async () => {
    const { repo, id } = await published(valueFlow("original"));
    const run = await repo.start(id, {}, owner, "delivery-1");
    expect((await repo.start(id, {}, owner, "delivery-1")).id).toBe(run.id);
    const current = await repo.get(id);
    await repo.save(id, current.revision, {
      name: "Changed",
      definition: valueFlow("changed"),
    });
    await repo.publish(id, current.revision + 1, owner);
    await processWorkflows(db, async () => true);
    const detail = await repo.execution(run.id);
    expect(detail.status).toBe("completed");
    expect(detail.jobs[0].output).toEqual({ result: "original" });
    await expect(
      new WorkflowRepository(db, "domain:other").get(id),
    ).rejects.toThrow();
    await expect(
      new WorkflowRepository(db, "domain:other").execution(run.id),
    ).rejects.toThrow();
  });
  it("captures every native transition with the active version in the write transaction", async () => {
    const { repo, id } = await published({
      trigger: {
        type: "updated",
        collection: "requests",
        changedFields: ["status"],
      },
      nodes: [
        {
          id: "value",
          type: "transform",
          values: { status: { ref: "trigger.status" } },
        },
      ],
    });
    const record = await createRecord(db, tenant, "requests", {
      title: "Tracked",
      status: "new",
    });
    await updateRecord(
      db,
      tenant,
      "requests",
      record.id,
      { status: "review" },
      { version: 1 },
    );
    await updateRecord(
      db,
      tenant,
      "requests",
      record.id,
      { status: "done" },
      { version: 2 },
    );
    await repo.setEnabled(id, false);
    await processWorkflows(db, async () => true);
    const runs = await repo.executions(id);
    expect(runs).toHaveLength(2);
    const outputs = await Promise.all(
      runs.map(async (run) => (await repo.execution(run.id)).jobs[0].output),
    );
    expect(outputs).toEqual(
      expect.arrayContaining([{ status: "review" }, { status: "done" }]),
    );
    await updateRecord(
      db,
      tenant,
      "requests",
      record.id,
      { status: "archived" },
      { version: 3 },
    );
    expect(await repo.executions(id)).toHaveLength(2);
  });
  it("rolls back event capture when the native transaction fails", async () => {
    const { repo, id } = await published({
      trigger: { type: "created", collection: "requests" },
      nodes: [{ id: "value", type: "transform", values: {} }],
    });
    await expect(
      db.batch([
        db
          .prepare(
            "INSERT INTO crm_records(id,tenant_id,object_name,data) VALUES ('rollback',?,'requests','{}')",
          )
          .bind(tenant),
        db.prepare(
          "INSERT INTO crm_write_guards(id,valid) VALUES ('invalid-workflow',0)",
        ),
      ]),
    ).rejects.toThrow();
    expect(await repo.executions(id)).toHaveLength(0);
    await repo.setEnabled(id, false);
  });
  it("executes the correct branch and atomically checkpoints record writes under competing workers", async () => {
    const { repo, id } = await published(
      manual([
        {
          id: "check",
          type: "condition",
          left: { ref: "trigger.amount" },
          operator: "gte",
          right: 10,
          next: "create",
          otherwise: "small",
        },
        {
          id: "create",
          type: "create",
          collection: "requests",
          values: { title: "Generated", status: "new" },
          next: "update",
        },
        {
          id: "update",
          type: "update",
          collection: "requests",
          recordId: { ref: "steps.create.id" },
          values: { status: "complete" },
        },
        { id: "small", type: "transform", values: { skipped: true } },
      ]),
    );
    const run = await repo.start(id, { amount: 20 }, owner, "branch-1");
    await Promise.all([
      processWorkflows(db, async () => true),
      processWorkflows(db, async () => true),
    ]);
    await processWorkflows(db, async () => true);
    const detail = await repo.execution(run.id);
    expect(detail.status).toBe("completed");
    expect(detail.jobs.map((j) => j.node_id)).toEqual([
      "check",
      "create",
      "update",
    ]);
    const result = detail.jobs[1].output as { id: string };
    expect(detail.jobs[1].output).toMatchObject({ created_by: owner });
    expect(detail.jobs[2].output).toMatchObject({ created_by: owner });
    expect(await getRecord(db, tenant, "requests", result.id)).toMatchObject({
      created_by: owner,
    });
    expect((await getRecord(db, tenant, "requests", result.id)).status).toBe(
      "complete",
    );
    const count = await db
      .prepare(
        "SELECT count(*) n FROM crm_records WHERE tenant_id=? AND json_extract(data,'$.title')='Generated'",
      )
      .bind(tenant)
      .first<{ n: number }>();
    expect(count?.n).toBe(1);
  });
  it("recovers an expired lease and refuses execution after permission revocation", async () => {
    const { repo, id } = await published(valueFlow("recovery"));
    const run = await repo.start(id, {}, owner, "recover");
    await db
      .prepare(
        "UPDATE workflow_executions SET status='running',lease_token='dead',lease_until=1 WHERE id=?",
      )
      .bind(run.id)
      .run();
    await processWorkflows(db, async () => false);
    expect((await repo.execution(run.id)).status).toBe("blocked");
    expect((await repo.execution(run.id)).jobs).toHaveLength(0);
  });
  it("suspends a delay durably and resumes only when due", async () => {
    const { repo, id } = await published(
      manual([
        { id: "wait", type: "delay", seconds: 60, next: "done" },
        { id: "done", type: "transform", values: { resumed: true } },
      ]),
    );
    const run = await repo.start(id, {}, owner, "delay");
    const now = Date.now();
    await processWorkflows(db, async () => true, { now });
    expect((await repo.execution(run.id)).status).toBe("waiting");
    await processWorkflows(db, async () => true, { now: now + 30_000 });
    expect((await repo.execution(run.id)).status).toBe("waiting");
    await processWorkflows(db, async () => true, { now: now + 61_000 });
    expect((await repo.execution(run.id)).status).toBe("completed");
  });
  it("creates a scoped task and notification once and resolves only the assigned user's item", async () => {
    const { repo, id } = await published(
      manual([
        {
          id: "task",
          type: "task",
          title: "Review request",
          assignee: { ref: "system.owner" },
          dueDays: 1,
          next: "notify",
        },
        {
          id: "notify",
          type: "notification",
          title: "Task ready",
          assignee: { ref: "system.owner" },
        },
      ]),
    );
    await repo.start(id, {}, owner, "inbox");
    await processWorkflows(db, async () => true);
    const items = await repo.inbox(owner);
    expect(items).toHaveLength(2);
    await expect(
      repo.resolveTask(items[0].id, "someone-else"),
    ).rejects.toThrow();
    await repo.resolveTask(items[0].id, owner);
    expect(
      (await repo.inbox(owner)).filter((i) => i.status === "done"),
    ).toHaveLength(1);
  });
  it("schedules one run per occurrence across concurrent ticks", async () => {
    const now = Date.now();
    const { repo, id } = await published({
      trigger: {
        type: "schedule",
        intervalMinutes: 1,
        startAt: new Date(now).toISOString(),
      },
      nodes: [{ id: "value", type: "transform", values: {} }],
    });
    await Promise.all([
      processWorkflows(db, async () => true, { now }),
      processWorkflows(db, async () => true, { now }),
    ]);
    expect(await repo.executions(id)).toHaveLength(1);
    await processWorkflows(db, async () => true, { now: now + 60_001 });
    expect(await repo.executions(id)).toHaveLength(2);
    await repo.setEnabled(id, false);
  });
});
