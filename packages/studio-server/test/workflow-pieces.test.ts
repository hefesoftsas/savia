import { migrationStatements } from "./migration-statements";
import { beforeAll, beforeEach, afterAll, describe, it, expect } from "vitest";
import { getPlatformProxy } from "wrangler";
import { readFileSync, readdirSync } from "node:fs";
import { WorkflowRepository } from "../src/workflows/repository";
import { processWorkflows } from "../src/workflows/runtime";
import {
  findWorkflowPiece,
  resolveWorkflowPieces,
  type WorkflowPieceHandler,
} from "../src/workflows/pieces";
import type { WorkflowDefinition } from "@savia/studio-shared/workflows";

let platform: Awaited<ReturnType<typeof getPlatformProxy<{ DB: D1Database }>>>;
let db: D1Database;
const workspace = "domain:pieces",
  owner = "user-pieces";
const shout: WorkflowPieceHandler = {
  descriptor: {
    id: "shout",
    version: 2,
    label: "Shout",
    inputs: [{ key: "text", label: "Text", type: "text", required: true }],
    outputs: ["loud"],
  },
  execute: async ({ config }) => ({
    loud: String(config.text).toUpperCase(),
  }),
};
const fragile: WorkflowPieceHandler = {
  descriptor: {
    id: "fragile",
    version: 1,
    label: "Fragile",
    inputs: [],
    outputs: [],
    retryable: false,
  },
  execute: async () => {
    throw new Error("broken piece");
  },
};
const pieces = () => resolveWorkflowPieces([shout, fragile]);
async function published(
  definition: WorkflowDefinition,
  handlers: WorkflowPieceHandler[] = [shout, fragile],
) {
  const repo = new WorkflowRepository(db, workspace, {
    pieces: handlers.map((piece) => piece.descriptor),
  });
  const draft = await repo.create({ name: "Piece flow", definition }, owner);
  await repo.publish(draft.id, draft.revision, owner);
  return { repo, id: draft.id };
}
const manual = (nodes: WorkflowDefinition["nodes"]): WorkflowDefinition => ({
  trigger: { type: "manual" },
  nodes,
});
const runOptions = { maxSteps: 20, pieces: pieces() };

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

describe("catalog piece actions", () => {
  it("resolves builtins and custom pieces by exact version", () => {
    const resolved = resolveWorkflowPieces([shout]);
    expect(findWorkflowPiece(resolved, "log", 1).descriptor.label).toBe(
      "Log message",
    );
    expect(findWorkflowPiece(resolved, "shout", 2).execute).toBeDefined();
    expect(() => findWorkflowPiece(resolved, "shout", 1)).toThrow();
    expect(() => findWorkflowPiece(resolved, "missing", 1)).toThrow();
  });

  it("runs the log piece and records its message", async () => {
    const { repo, id } = await published(
      manual([
        {
          id: "note",
          type: "piece",
          pieceId: "log",
          pieceVersion: 1,
          config: { message: { ref: "trigger.text" } },
          next: "done",
        },
        { id: "done", type: "transform", values: {} },
      ]),
    );
    const run = await repo.start(id, { text: "hello" }, owner, "piece-log");
    await processWorkflows(db, async () => true, runOptions);
    const detail = await repo.execution(run.id);
    expect(detail.status).toBe("completed");
    expect(detail.jobs[0].output).toEqual({ message: "hello" });
  });

  it("runs custom pieces with resolved references", async () => {
    const { repo, id } = await published(
      manual([
        {
          id: "loud",
          type: "piece",
          pieceId: "shout",
          pieceVersion: 2,
          config: { text: { ref: "trigger.text" } },
        },
      ]),
    );
    const run = await repo.start(id, { text: "hey" }, owner, "piece-custom");
    await processWorkflows(db, async () => true, runOptions);
    const detail = await repo.execution(run.id);
    expect(detail.status).toBe("completed");
    expect(detail.jobs[0].output).toEqual({ loud: "HEY" });
  });

  it("fails fast for unknown pieces and invalid configs", async () => {
    const repo = new WorkflowRepository(db, workspace, {
      pieces: [shout.descriptor],
    });
    for (const node of [
      { id: "bad", type: "piece", pieceId: "missing", pieceVersion: 1 },
      {
        id: "bad",
        type: "piece",
        pieceId: "shout",
        pieceVersion: 2,
        config: { text: 42 },
      },
    ]) {
      const draft = await repo.create(
        { name: "Bad piece", definition: manual([node]) },
        owner,
      );
      await expect(
        repo.publish(draft.id, draft.revision, owner),
      ).rejects.toMatchObject({ status: 422 });
    }
  });

  it("does not retry pieces that declare themselves non-retryable", async () => {
    const { repo, id } = await published(
      manual([
        { id: "brittle", type: "piece", pieceId: "fragile", pieceVersion: 1 },
      ]),
    );
    const run = await repo.start(id, {}, owner, "piece-fragile");
    await processWorkflows(db, async () => true, runOptions);
    const detail = await repo.execution(run.id);
    expect(detail.status).toBe("failed");
    expect(detail.error).toContain("broken piece");
  });
});
