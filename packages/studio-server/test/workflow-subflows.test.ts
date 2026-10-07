import { migrationStatements } from "./migration-statements";
import { beforeAll, beforeEach, afterAll, describe, it, expect } from "vitest";
import { getPlatformProxy } from "wrangler";
import { readFileSync, readdirSync } from "node:fs";
import { WorkflowRepository } from "../src/workflows/repository";
import { processWorkflows } from "../src/workflows/runtime";
import type { WorkflowDefinition } from "@savia/studio-shared/workflows";

let platform: Awaited<ReturnType<typeof getPlatformProxy<{ DB: D1Database }>>>;
let db: D1Database;
const workspace = "domain:subflows",
  owner = "user-subflows";
let serial = 0;
async function published(definition: WorkflowDefinition) {
  const repo = new WorkflowRepository(db, workspace);
  const draft = await repo.create(
    { name: `Flow ${++serial}`, definition },
    owner,
  );
  await repo.publish(draft.id, draft.revision, owner);
  const publishedRow = await repo.get(draft.id);
  return { repo, id: draft.id, version: publishedRow.published_version! };
}
const manual = (nodes: WorkflowDefinition["nodes"]): WorkflowDefinition => ({
  trigger: { type: "manual" },
  nodes,
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
});
afterAll(async () => platform?.dispose());
beforeEach(async () => {
  await db
    .prepare(
      "UPDATE workflow_executions SET status='cancelled' WHERE status IN ('queued','running','waiting')",
    )
    .run();
});

describe("reusable subflow calls", () => {
  it("calls a pinned version and returns its steps", async () => {
    const child = await published(
      manual([
        {
          id: "echo",
          type: "transform",
          values: { greeting: { ref: "trigger.name" } },
        },
      ]),
    );
    const childId = (await child.repo.get(child.id)).id;
    const parent = await published(
      manual([
        {
          id: "call",
          type: "subflow",
          workflowId: childId,
          workflowVersion: child.version,
          input: { name: { ref: "trigger.who" } },
          next: "done",
        },
        {
          id: "done",
          type: "transform",
          values: { got: { ref: "steps.call.steps.echo.greeting" } },
        },
      ]),
    );
    const run = await parent.repo.start(
      parent.id,
      { who: "Ada" },
      owner,
      "subflow-return",
    );
    await processWorkflows(db, async () => true);
    await processWorkflows(db, async () => true);
    const detail = await parent.repo.execution(run.id);
    expect(detail.status).toBe("completed");
    expect(detail.jobs.map((job) => job.node_id)).toEqual([
      "call",
      "echo",
      "call",
      "done",
    ]);
    expect(detail.jobs[0].output).toMatchObject({ started: true });
    expect(detail.jobs[2].output).toMatchObject({
      steps: { echo: { greeting: "Ada" } },
    });
    expect(detail.jobs[3].output).toMatchObject({ got: "Ada" });
  });

  it("rejects unpublished children, missing pins and self calls", async () => {
    const repo = new WorkflowRepository(db, workspace);
    const draft = await repo.create(
      {
        name: "Draft child",
        definition: manual([{ id: "echo", type: "transform", values: {} }]),
      },
      owner,
    );
    const callOf = (workflowId: string, workflowVersion: string) =>
      manual([
        {
          id: "call",
          type: "subflow",
          workflowId,
          workflowVersion,
          next: "done",
        },
        { id: "done", type: "transform", values: {} },
      ]);
    const parent = await repo.create(
      { name: "Parent", definition: callOf(draft.id, `${draft.id}:1`) },
      owner,
    );
    await expect(
      repo.publish(parent.id, parent.revision, owner),
    ).rejects.toMatchObject({
      status: 422,
    });
    await repo.publish(draft.id, draft.revision, owner);
    const fresh = await repo.get(draft.id);
    const pinned = await repo.create(
      {
        name: "Pinned",
        definition: callOf(draft.id, fresh.published_version!),
      },
      owner,
    );
    await repo.publish(pinned.id, pinned.revision, owner);
    const missing = await repo.create(
      { name: "Missing", definition: callOf(draft.id, `${draft.id}:99`) },
      owner,
    );
    await expect(
      repo.publish(missing.id, missing.revision, owner),
    ).rejects.toMatchObject({
      status: 422,
    });
    const selfish = await repo.create(
      {
        name: "Selfish",
        definition: manual([{ id: "echo", type: "transform", values: {} }]),
      },
      owner,
    );
    const selfishCall = await repo.save(selfish.id, selfish.revision, {
      name: "Selfish",
      definition: callOf(selfish.id, `${selfish.id}:1`),
    });
    await expect(
      repo.publish(selfishCall.id, selfishCall.revision, owner),
    ).rejects.toMatchObject({ status: 422 });
  });

  it("rejects call cycles across workflows", async () => {
    const repo = new WorkflowRepository(db, workspace);
    const plain = (extra: WorkflowDefinition["nodes"] = []) =>
      manual([{ id: "echo", type: "transform", values: {} }, ...extra]);
    const left = await repo.create(
      { name: "Left", definition: plain() },
      owner,
    );
    await repo.publish(left.id, left.revision, owner);
    const leftRow = await repo.get(left.id);
    const right = await repo.create(
      {
        name: "Right",
        definition: manual([
          {
            id: "call",
            type: "subflow",
            workflowId: left.id,
            workflowVersion: leftRow.published_version!,
            next: "done",
          },
          { id: "done", type: "transform", values: {} },
        ]),
      },
      owner,
    );
    await repo.publish(right.id, right.revision, owner);
    const rightRow = await repo.get(right.id);
    const looping = await repo.save(left.id, leftRow.revision, {
      name: "Left",
      definition: manual([
        {
          id: "call",
          type: "subflow",
          workflowId: right.id,
          workflowVersion: rightRow.published_version!,
          next: "done",
        },
        { id: "done", type: "transform", values: {} },
      ]),
    });
    await expect(
      repo.publish(looping.id, looping.revision, owner),
    ).rejects.toMatchObject({ status: 422 });
  });

  it("detects cycles through pinned versions even after drafts diverge", async () => {
    const repo = new WorkflowRepository(db, workspace);
    const plain = (extra: WorkflowDefinition["nodes"] = []) =>
      manual([{ id: "echo", type: "transform", values: {} }, ...extra]);
    const callOf = (workflowId: string, workflowVersion: string) =>
      manual([
        {
          id: "call",
          type: "subflow",
          workflowId,
          workflowVersion,
          next: "done",
        },
        { id: "done", type: "transform", values: {} },
      ]);
    const first = await repo.create(
      { name: "First", definition: plain() },
      owner,
    );
    await repo.publish(first.id, first.revision, owner);
    const firstRow = await repo.get(first.id);
    // Second is published calling First.
    const second = await repo.create(
      {
        name: "Second",
        definition: callOf(first.id, firstRow.published_version!),
      },
      owner,
    );
    await repo.publish(second.id, second.revision, owner);
    const secondRow = await repo.get(second.id);
    // Second's draft drops the call, but its pin still references First.
    await repo.save(second.id, secondRow.revision, {
      name: "Second",
      definition: plain(),
    });
    // First calling Second's published pin must be rejected: executions
    // would recurse through the pin even though the draft looks acyclic.
    const looping = await repo.save(first.id, firstRow.revision, {
      name: "First",
      definition: callOf(second.id, secondRow.published_version!),
    });
    await expect(
      repo.publish(looping.id, looping.revision, owner),
    ).rejects.toMatchObject({ status: 422 });
  });

  it("bounds call depth at runtime", async () => {
    const repo = new WorkflowRepository(db, workspace);
    let next: { id: string; version: string } | null = null;
    for (let level = 6; level >= 0; level--) {
      const definition =
        level === 6
          ? manual([{ id: "leaf", type: "transform", values: { depth: 6 } }])
          : manual([
              {
                id: "call",
                type: "subflow",
                workflowId: next!.id,
                workflowVersion: next!.version,
                next: "done",
              },
              { id: "done", type: "transform", values: {} },
            ]);
      const draft = await repo.create(
        { name: `Depth ${level}`, definition },
        owner,
      );
      await repo.publish(draft.id, draft.revision, owner);
      const row = await repo.get(draft.id);
      next = { id: draft.id, version: row.published_version! };
    }
    const run = await repo.start(next!.id, {}, owner, "subflow-depth");
    await processWorkflows(db, async () => true);
    const detail = await repo.execution(run.id);
    expect(detail.status).toBe("failed");
    expect(detail.error).toContain("depth");
  });

  it("fails the execution when a child step fails", async () => {
    const child = await published(
      manual([
        {
          id: "broken",
          type: "transform",
          values: { v: { ref: "trigger.missing" } },
        },
      ]),
    );
    const childId = (await child.repo.get(child.id)).id;
    const parent = await published(
      manual([
        {
          id: "call",
          type: "subflow",
          workflowId: childId,
          workflowVersion: child.version,
          next: "done",
        },
        { id: "done", type: "transform", values: {} },
      ]),
    );
    const run = await parent.repo.start(
      parent.id,
      {},
      owner,
      "subflow-child-fails",
    );
    const now = Date.now();
    for (let tick = 0; tick < 3; tick++)
      await processWorkflows(db, async () => true, { now: now + tick * 60000 });
    const detail = await parent.repo.execution(run.id);
    expect(detail.status).toBe("failed");
    expect(detail.error).toContain("trigger.missing");
    expect(detail.jobs.map((job) => job.node_id)).toEqual(["call"]);
  });
});
