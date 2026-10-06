import { migrationStatements } from "./migration-statements";
import { beforeAll, beforeEach, afterAll, describe, it, expect } from "vitest";
import { getPlatformProxy } from "wrangler";
import { readFileSync, readdirSync } from "node:fs";
import { WorkflowRepository } from "../src/workflows/repository";
import { processWorkflows } from "../src/workflows/runtime";
import type { WorkflowDefinition } from "@savia/studio-shared/workflows";

let platform: Awaited<ReturnType<typeof getPlatformProxy<{ DB: D1Database }>>>;
let db: D1Database;
const workspace = "domain:approvals",
  owner = "user-approvals";
async function published(definition: WorkflowDefinition) {
  const repo = new WorkflowRepository(db, workspace);
  const draft = await repo.create({ name: "Approval flow", definition }, owner);
  await repo.publish(draft.id, draft.revision, owner);
  return { repo, id: draft.id };
}
const gate = (
  next: string,
  otherwise: string,
  dueDays = 1,
): WorkflowDefinition["nodes"] => [
  {
    id: "gate",
    type: "approval",
    title: "Ship it?",
    assignee: owner,
    dueDays,
    next,
    otherwise,
  },
  { id: "ship", type: "transform", values: { shipped: true } },
  { id: "hold", type: "transform", values: { shipped: false } },
];
const manual = (nodes: WorkflowDefinition["nodes"]): WorkflowDefinition => ({
  trigger: { type: "manual" },
  nodes,
});
async function ticked(options: { now?: number } = {}) {
  await processWorkflows(db, async () => true, { maxSteps: 20, ...options });
}
async function openApprovalId(
  repo: WorkflowRepository,
  user = owner,
): Promise<string> {
  const inbox = await repo.inbox(user);
  const item = inbox.find(
    (entry) => entry.kind === "approval" && entry.status === "open",
  );
  if (!item) throw new Error("Approval inbox item missing");
  return item.id;
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

describe("blocking human approvals", () => {
  it("suspends until approval and continues on the approved branch", async () => {
    const { repo, id } = await published(manual(gate("ship", "hold")));
    const run = await repo.start(id, {}, owner, "approval-yes");
    await ticked();
    const first = await repo.execution(run.id);
    expect(first.status).toBe("waiting");
    await repo.resolveApproval(
      await openApprovalId(repo),
      owner,
      "approved",
      "looks good",
    );
    await ticked();
    const detail = await repo.execution(run.id);
    expect(detail.status).toBe("completed");
    expect(detail.jobs.map((job) => job.node_id)).toEqual(["gate", "ship"]);
    expect(detail.jobs[0].output).toMatchObject({
      decision: "approved",
      by: owner,
      comment: "looks good",
    });
  });

  it("routes rejection with its comment to the other branch", async () => {
    const { repo, id } = await published(manual(gate("ship", "hold")));
    const run = await repo.start(id, {}, owner, "approval-no");
    await ticked();
    await repo.resolveApproval(
      await openApprovalId(repo),
      owner,
      "rejected",
      "not yet",
    );
    await ticked();
    const detail = await repo.execution(run.id);
    expect(detail.status).toBe("completed");
    expect(detail.jobs.map((job) => job.node_id)).toEqual(["gate", "hold"]);
    expect(detail.jobs[0].output).toMatchObject({
      decision: "rejected",
      comment: "not yet",
    });
  });

  it("expires past the due date onto the rejection branch", async () => {
    const { repo, id } = await published(manual(gate("ship", "hold", 1)));
    const run = await repo.start(id, {}, owner, "approval-expiry");
    const now = Date.now();
    await ticked({ now });
    expect((await repo.execution(run.id)).status).toBe("waiting");
    await ticked({ now: now + 2 * 86400000 });
    const detail = await repo.execution(run.id);
    expect(detail.status).toBe("completed");
    expect(detail.jobs.map((job) => job.node_id)).toEqual(["gate", "hold"]);
    expect(detail.jobs[0].output).toMatchObject({ decision: "expired" });
  });

  it("rejects duplicate, late and foreign decisions", async () => {
    const { repo, id } = await published(manual(gate("ship", "hold")));
    const run = await repo.start(id, {}, owner, "approval-once");
    await ticked();
    const approval = await openApprovalId(repo);
    await expect(
      repo.resolveApproval(approval, "someone-else", "approved"),
    ).rejects.toMatchObject({ status: 404 });
    await repo.resolveApproval(approval, owner, "approved");
    await expect(
      repo.resolveApproval(approval, owner, "rejected"),
    ).rejects.toMatchObject({ status: 404 });
    await ticked();
    expect((await repo.execution(run.id)).status).toBe("completed");
    await expect(
      repo.resolveApproval(approval, owner, "rejected"),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("voids decisions after cancellation", async () => {
    const { repo, id } = await published(manual(gate("ship", "hold")));
    const run = await repo.start(id, {}, owner, "approval-cancel");
    await ticked();
    const approval = await openApprovalId(repo);
    await repo.cancel(run.id);
    await expect(
      repo.resolveApproval(approval, owner, "approved"),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("assigns one approval per loop pass", async () => {
    const { repo, id } = await published(
      manual([
        {
          id: "repeat",
          type: "loop",
          items: { ref: "trigger.tags" },
          body: "gate",
          next: "done",
        },
        {
          id: "gate",
          type: "approval",
          title: { concat: ["Release ", { ref: "steps.repeat.item" }] },
          assignee: owner,
          dueDays: 1,
        },
        { id: "done", type: "transform", values: {} },
      ]),
    );
    const run = await repo.start(
      id,
      { tags: ["a", "b"] },
      owner,
      "approval-loop",
    );
    for (let round = 0; round < 2; round++) {
      await ticked();
      await repo.resolveApproval(await openApprovalId(repo), owner, "approved");
    }
    await ticked();
    await ticked();
    const detail = await repo.execution(run.id);
    expect(detail.status).toBe("completed");
    expect(detail.jobs.map((job) => job.node_id)).toEqual([
      "repeat",
      "gate",
      "repeat",
      "gate",
      "done",
    ]);
  });
});
