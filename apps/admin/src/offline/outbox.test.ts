import { describe, expect, it } from "vitest";
import {
  canQueue,
  discardOutboxOp,
  enqueueOutboxOp,
  flushOutbox,
  listOutboxOps,
  requeueOutboxOp,
  type OutboxOp,
  type OutboxTable,
} from "./outbox";

function stubTable(): OutboxTable & { rows: Map<number, OutboxOp> } {
  const rows = new Map<number, OutboxOp>();
  let nextId = 1;
  return {
    rows,
    get: async (id: number) => rows.get(id),
    add: async (op: OutboxOp) => {
      const id = nextId++;
      rows.set(id, { ...op, id });
      return id;
    },
    put: async (op: OutboxOp) => {
      if (op.id !== undefined) rows.set(op.id, op);
    },
    delete: async (id: number) => {
      rows.delete(id);
    },
    where: (index: string) => ({
      equals: (value: unknown) => ({
        toArray: async () =>
          [...rows.values()].filter(
            (row) =>
              (row as unknown as Record<string, unknown>)[index] === value,
          ),
      }),
    }),
  };
}

describe("canQueue", () => {
  it("allows personal preferences and nothing destructive", () => {
    expect(canQueue("user-preferences", "save-appearance")).toBe(true);
    expect(canQueue("user-preferences", "save-sidebar")).toBe(true);
    expect(canQueue("users", "delete")).toBe(false);
    expect(canQueue("users", "update")).toBe(false);
    expect(canQueue("tenants", "delete")).toBe(false);
    expect(canQueue("users", "suspend")).toBe(false);
    expect(canQueue("crm", "create-record")).toBe(false);
  });
});

describe("enqueueOutboxOp", () => {
  it("rejects ineligible resources", async () => {
    const table = stubTable();
    await expect(
      enqueueOutboxOp(
        { resource: "users", action: "delete", payload: { id: "p-1" } },
        table,
      ),
    ).rejects.toThrow(/not queueable/);
    expect(table.rows.size).toBe(0);
  });

  it("replaces pending ops for the same action (last-write-wins)", async () => {
    const table = stubTable();
    await enqueueOutboxOp(
      {
        resource: "user-preferences",
        action: "save-appearance",
        payload: { v: 1 },
      },
      table,
    );
    await enqueueOutboxOp(
      {
        resource: "user-preferences",
        action: "save-appearance",
        payload: { v: 2 },
      },
      table,
    );
    const ops = await listOutboxOps(table);
    expect(ops).toHaveLength(1);
    expect(ops[0].payload).toEqual({ v: 2 });
    expect(ops[0].status).toBe("pending");
  });
});

describe("flushOutbox", () => {
  it("sends pending ops and removes them", async () => {
    const table = stubTable();
    await enqueueOutboxOp(
      { resource: "user-preferences", action: "save-appearance", payload: {} },
      table,
    );
    const executed: OutboxOp[] = [];
    const summary = await flushOutbox(async (op) => {
      executed.push(op);
    }, table);

    expect(summary).toEqual({ succeeded: 1, failed: [] });
    expect(executed).toHaveLength(1);
    expect(await listOutboxOps(table)).toHaveLength(0);
  });

  it("marks failures without auto-retrying them", async () => {
    const table = stubTable();
    await enqueueOutboxOp(
      { resource: "user-preferences", action: "save-appearance", payload: {} },
      table,
    );
    let calls = 0;
    const summary = await flushOutbox(async () => {
      calls += 1;
      throw new Error("VALIDATION_ERROR");
    }, table);

    expect(summary.succeeded).toBe(0);
    expect(summary.failed).toHaveLength(1);
    const ops = await listOutboxOps(table);
    expect(ops).toHaveLength(1);
    expect(ops[0].status).toBe("failed");

    // A second flush does not touch failed ops by itself.
    await flushOutbox(async () => {
      calls += 1;
    }, table);
    expect(calls).toBe(1);

    // Explicit retry goes through again.
    await requeueOutboxOp(ops[0].id!, table);
    await flushOutbox(async () => {
      calls += 1;
    }, table);
    expect(calls).toBe(2);
    expect(await listOutboxOps(table)).toHaveLength(0);
  });

  it("aborts on offline errors keeping everything pending", async () => {
    const table = stubTable();
    await enqueueOutboxOp(
      { resource: "user-preferences", action: "save-appearance", payload: {} },
      table,
    );
    const summary = await flushOutbox(async () => {
      throw new TypeError("Failed to fetch");
    }, table);

    expect(summary).toEqual({ succeeded: 0, failed: [] });
    const ops = await listOutboxOps(table);
    expect(ops).toHaveLength(1);
    expect(ops[0].status).toBe("pending");
  });

  it("discards ops explicitly", async () => {
    const table = stubTable();
    await enqueueOutboxOp(
      { resource: "user-preferences", action: "save-sidebar", payload: {} },
      table,
    );
    const [op] = await listOutboxOps(table);
    await discardOutboxOp(op.id!, table);
    expect(await listOutboxOps(table)).toHaveLength(0);
  });
});
