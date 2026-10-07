import { migrationStatements } from "./migration-statements";
import { beforeAll, beforeEach, afterAll, describe, it, expect } from "vitest";
import { getPlatformProxy } from "wrangler";
import { readFileSync, readdirSync } from "node:fs";
import { WorkflowRepository } from "../src/workflows/repository";
import { processWorkflows } from "../src/workflows/runtime";
import type { WorkflowDefinition } from "@savia/studio-shared/workflows";

let platform: Awaited<ReturnType<typeof getPlatformProxy<{ DB: D1Database }>>>;
let db: D1Database;
const workspace = "domain:parallel",
  owner = "user-parallel";
async function published(definition: WorkflowDefinition) {
  const repo = new WorkflowRepository(db, workspace);
  const draft = await repo.create({ name: "Parallel flow", definition }, owner);
  await repo.publish(draft.id, draft.revision, owner);
  return { repo, id: draft.id };
}
const manual = (nodes: WorkflowDefinition["nodes"]): WorkflowDefinition => ({
  trigger: { type: "manual" },
  nodes,
});
const diamond = (
  left: WorkflowDefinition["nodes"][number],
  right: WorkflowDefinition["nodes"][number],
): WorkflowDefinition =>
  manual([
    { id: "fork", type: "parallel", branches: ["left", "right"] },
    { ...left, id: "left" } as WorkflowDefinition["nodes"][number],
    { ...right, id: "right" } as WorkflowDefinition["nodes"][number],
    { id: "join", type: "merge", next: "done" },
    {
      id: "done",
      type: "transform",
      values: { lanes: { ref: "steps.join.count" } },
    },
  ]);
async function ticked() {
  await processWorkflows(db, async () => true, { maxSteps: 20 });
}

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
});
afterAll(async () => platform?.dispose());
beforeEach(async () => {
  await db
    .prepare(
      "UPDATE workflow_executions SET status='cancelled' WHERE status IN ('queued','running','waiting')",
    )
    .run();
});

describe("parallel branches with a merge join", () => {
  it("runs every branch once and combines their outputs", async () => {
    const { repo, id } = await published(
      diamond(
        { type: "transform", values: { x: 1 }, next: "join" },
        { type: "transform", values: { y: 2 }, next: "join" },
      ),
    );
    const run = await repo.start(id, {}, owner, "parallel-diamond");
    await ticked();
    await ticked();
    const detail = await repo.execution(run.id);
    expect(detail.status).toBe("completed");
    expect(detail.jobs.map((job) => job.node_id)).toEqual([
      "fork",
      "left",
      "right",
      "join",
      "done",
    ]);
    expect(detail.jobs[3].output).toMatchObject({
      branches: { left: { x: 1 }, right: { y: 2 } },
      count: 2,
    });
    expect(detail.jobs[4].output).toMatchObject({ lanes: 2 });
  });

  it("fails the execution when a branch step fails", async () => {
    const { repo, id } = await published(
      diamond(
        { type: "transform", values: { x: 1 }, next: "join" },
        {
          type: "transform",
          values: { y: { ref: "trigger.missing" } },
          next: "join",
          maxAttempts: 1,
        },
      ),
    );
    const run = await repo.start(id, {}, owner, "parallel-fails");
    await ticked();
    const detail = await repo.execution(run.id);
    expect(detail.status).toBe("failed");
    expect(detail.jobs.map((job) => job.node_id)).toContain("left");
    expect(detail.jobs.map((job) => job.node_id)).not.toContain("join");
  });

  it("continues a failed branch step inside its region", async () => {
    const { repo, id } = await published(
      diamond(
        { type: "transform", values: { x: 1 }, next: "join" },
        {
          type: "transform",
          values: { y: { ref: "trigger.missing" } },
          next: "join",
          maxAttempts: 1,
          onError: "continue",
        },
      ),
    );
    const run = await repo.start(id, {}, owner, "parallel-continues");
    await ticked();
    await ticked();
    const detail = await repo.execution(run.id);
    expect(detail.status).toBe("completed");
    expect(detail.jobs.map((job) => job.node_id)).toEqual([
      "fork",
      "left",
      "right",
      "join",
      "done",
    ]);
    expect(detail.jobs[2].output).toMatchObject({
      error: expect.any(String),
    });
  });

  it("runs conditions inside branches and still joins once", async () => {
    const { repo, id } = await published(
      manual([
        { id: "fork", type: "parallel", branches: ["left", "right"] },
        {
          id: "left",
          type: "condition",
          left: { ref: "trigger.flag" },
          operator: "eq",
          right: true,
          next: "left_yes",
          otherwise: "left_no",
        },
        { id: "left_yes", type: "transform", values: { lane: "yes" }, next: "join" },
        { id: "left_no", type: "transform", values: { lane: "no" }, next: "join" },
        { id: "right", type: "transform", values: { lane: "right" }, next: "join" },
        { id: "join", type: "merge", next: "done" },
        {
          id: "done",
          type: "transform",
          values: { lanes: { ref: "steps.join.count" } },
        },
      ]),
    );
    const run = await repo.start(id, { flag: true }, owner, "parallel-cond");
    await ticked();
    await ticked();
    await ticked();
    const detail = await repo.execution(run.id);
    expect(detail.status).toBe("completed");
    expect(detail.jobs.map((job) => job.node_id)).toEqual([
      "fork",
      "left",
      "right",
      "left_yes",
      "join",
      "done",
    ]);
    expect(detail.jobs.find((job) => job.node_id === "join")?.output).toMatchObject({
      count: 2,
    });
  });
});
