import { migrationStatements } from "./migration-statements";
import { beforeAll, beforeEach, afterAll, describe, it, expect, vi } from "vitest";
import { getPlatformProxy } from "wrangler";
import { readFileSync, readdirSync } from "node:fs";
import { WorkflowRepository } from "../src/workflows/repository";
import { processWorkflows } from "../src/workflows/runtime";
import type { WorkflowDefinition } from "@savia/studio-shared/workflows";

let platform: Awaited<ReturnType<typeof getPlatformProxy<{ DB: D1Database }>>>;
let db: D1Database;
const workspace = "domain:email",
  owner = "user-email";
let serial = 0;
async function published(definition: WorkflowDefinition) {
  const repo = new WorkflowRepository(db, workspace);
  const draft = await repo.create(
    { name: `Email ${++serial}`, definition },
    owner,
  );
  await repo.publish(draft.id, draft.revision, owner);
  return { repo, id: draft.id };
}
const emailFlow = (to: unknown): WorkflowDefinition => ({
  trigger: { type: "manual" },
  nodes: [
    {
      id: "mail",
      type: "email",
      to: to as string,
      subject: "Order update",
      body: "Your order shipped.",
    } as never,
  ],
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

describe("email steps", () => {
  it("sends through the injected sender and records acceptance", async () => {
    const sent: unknown[] = [];
    const { repo, id } = await published(emailFlow("buyer@example.com"));
    const run = await repo.start(id, {}, owner, `email-ok-${Date.now()}`);
    await processWorkflows(db, async () => true, {
      maxSteps: 20,
      email: { sendEmail: async (mail) => void sent.push(mail) },
    });
    await processWorkflows(db, async () => true, { maxSteps: 20 });
    const detail = await repo.execution(run.id);
    expect(detail.status).toBe("completed");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      to: "buyer@example.com",
      subject: "Order update",
      workspace,
    });
    expect(detail.jobs[0].output).toMatchObject({
      to: "buyer@example.com",
      accepted: true,
    });
    await repo.setEnabled(id, false);
  });

  it("fails visibly without a configured sender", async () => {
    const { repo, id } = await published(emailFlow("buyer@example.com"));
    const run = await repo.start(id, {}, owner, `email-missing-${Date.now()}`);
    await processWorkflows(db, async () => true, { maxSteps: 1 });
    const detail = await repo.execution(run.id);
    expect(detail.status).toBe("queued");
    expect(detail.error ?? "").toMatch(/not configured|Email/);
    await repo.setEnabled(id, false);
  });

  it("rejects invalid recipients at publication", async () => {
    const repo = new WorkflowRepository(db, workspace);
    await expect(
      repo.create(
        { name: "Bad email", definition: emailFlow("not-an-email") },
        owner,
      ),
    ).rejects.toThrow();
  });
});
