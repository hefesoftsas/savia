import { migrationStatements } from "./migration-statements";
import { beforeAll, beforeEach, afterAll, describe, it, expect } from "vitest";
import { getPlatformProxy } from "wrangler";
import { readFileSync, readdirSync } from "node:fs";
import { makeConfig } from "@savia/studio-shared/metadata";
import { createRecord, updateRecord } from "../src/services";
import { WorkflowRepository } from "../src/workflows/repository";
import { processWorkflows } from "../src/workflows/runtime";
import type { WorkflowDefinition } from "@savia/studio-shared/workflows";

let platform: Awaited<ReturnType<typeof getPlatformProxy<{ DB: D1Database }>>>;
let db: D1Database;
const workspace = "domain:validate",
  owner = "user-validate";
let serial = 0;
async function published(definition: WorkflowDefinition) {
  const repo = new WorkflowRepository(db, workspace);
  const draft = await repo.create(
    { name: `Validate ${++serial}`, definition },
    owner,
  );
  await repo.publish(draft.id, draft.revision, owner);
  return { repo, id: draft.id };
}
const gate = (
  conditions: { field: string; operator: "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "contains" | "empty" | "not_empty"; value: string | number | boolean | null }[],
  values: Record<string, unknown> = {},
): WorkflowDefinition => ({
  trigger: { type: "validate", collection: "orders", conditions },
  nodes: [{ id: "note", type: "transform", values }],
});

beforeAll(async () => {
  platform = await getPlatformProxy({
    configPath: "wrangler.jsonc",
    persist: false,
  });
  db = platform.env.DB;
  for (const name of readdirSync("migrations")
    .filter((n) => n.endsWith(".sql"))
    .sort()) {
    for (const sql of migrationStatements(
      readFileSync(`migrations/${name}`, "utf8"),
    ))
      await db.prepare(sql).run();
  }
  await db
    .prepare("INSERT INTO studio_objects(tenant_id,name,label,config) VALUES (?,?,?,?)")
    .bind(
      workspace,
      "customers",
      "Customers",
      JSON.stringify(makeConfig({ tier: { type: "Textbox", label: "Tier" } })),
    )
    .run();
  await db
    .prepare("INSERT INTO studio_objects(tenant_id,name,label,config) VALUES (?,?,?,?)")
    .bind(
      workspace,
      "orders",
      "Orders",
      JSON.stringify(
        makeConfig({
          amount: { type: "Number", label: "Amount" },
          customer: {
            type: "Textbox",
            label: "Customer",
            config: { relation: "customers" },
          },
        }),
      ),
    )
    .run();
});
afterAll(async () => platform?.dispose());
beforeEach(async () => {
  await db
    .prepare(
      "UPDATE workflow_executions SET status='cancelled' WHERE status IN ('queued','running','waiting')",
    )
    .run();
});

describe("pre-save validation workflows", () => {
  it("rejects forbidden states before the write and runs steps for passing writes", async () => {
    const { repo, id } = await published(
      gate([{ field: "amount", operator: "gte", value: 1000 }]),
    );
    await expect(
      createRecord(db, workspace, "orders", { amount: 2000 }),
    ).rejects.toMatchObject({ status: 422 });
    expect(await repo.executions(id)).toHaveLength(0);
    const ok = await createRecord(db, workspace, "orders", { amount: 10 });
    expect(ok.amount).toBe(10);
    await processWorkflows(db, async () => true, { maxSteps: 20 });
    await processWorkflows(db, async () => true, { maxSteps: 20 });
    const runs = await repo.executions(id);
    expect(runs).toHaveLength(1);
    expect((await repo.execution(runs[0].id)).status).toBe("completed");
    await repo.setEnabled(id, false);
  });

  it("evaluates related snapshots in the gate", async () => {
    const banned = await createRecord(db, workspace, "customers", { tier: "banned" });
    const good = await createRecord(db, workspace, "customers", { tier: "ok" });
    const { repo, id } = await published(
      gate(
        [{ field: "related.customer.tier", operator: "eq", value: "banned" }],
        { tier: { ref: "trigger.related.customer.tier" } },
      ),
    );
    await expect(
      createRecord(db, workspace, "orders", { amount: 1, customer: banned.id }),
    ).rejects.toMatchObject({ status: 422 });
    await createRecord(db, workspace, "orders", { amount: 1, customer: good.id });
    await processWorkflows(db, async () => true, { maxSteps: 20 });
    const runs = await repo.executions(id);
    expect(runs).toHaveLength(1);
    const detail = await repo.execution(runs[0].id);
    expect(detail.jobs[0].output).toMatchObject({ tier: "ok" });
    await repo.setEnabled(id, false);
  });

  it("honors changed fields on updates only", async () => {
    const { repo, id } = await published({
      trigger: {
        type: "validate",
        collection: "orders",
        conditions: [{ field: "amount", operator: "gte", value: 1000 }],
        changedFields: ["amount"],
      },
      nodes: [{ id: "note", type: "transform", values: {} }],
    });
    const record = await createRecord(db, workspace, "orders", { amount: 900 });
    await expect(
      updateRecord(db, workspace, "orders", record.id, { amount: 1500 }, { version: 1 }),
    ).rejects.toMatchObject({ status: 422 });
    await repo.setEnabled(id, false);
  });
});
