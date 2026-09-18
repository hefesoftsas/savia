import { getOfflineDb, type OutboxOp } from "./db";
import { isOfflineError } from "./offline-error";

export type { OutboxOp };

export type OutboxTable = {
  get(id: number): Promise<OutboxOp | undefined>;
  add(op: OutboxOp): Promise<number>;
  put(op: OutboxOp): Promise<unknown>;
  delete(id: number): Promise<unknown>;
  where(index: string): {
    equals(value: unknown): { toArray(): Promise<OutboxOp[]> };
  };
};

/**
 * Resources allowed into the offline mutation queue. Identity (`users`,
 * `tenants`, suspensions, sessions, passwords, memberships) is excluded by
 * design: server guards can reject queued identity ops at sync time with no
 * safe automatic resolution. Only last-write-wins personal preferences are
 * eligible for now.
 */
const ELIGIBLE_ACTIONS: ReadonlySet<string> = new Set([
  "user-preferences:save-appearance",
  "user-preferences:save-sidebar",
]);

export function canQueue(resource: string, action: string): boolean {
  return ELIGIBLE_ACTIONS.has(`${resource}:${action}`);
}

function table(overrides?: OutboxTable): OutboxTable {
  return overrides ?? getOfflineDb().outbox;
}

export async function listOutboxOps(
  overrides?: OutboxTable,
): Promise<OutboxOp[]> {
  // Dexie has no "all" shortcut on the typed surface; read both statuses.
  const [pending, failed] = await Promise.all([
    table(overrides).where("status").equals("pending").toArray(),
    table(overrides).where("status").equals("failed").toArray(),
  ]);
  return [...pending, ...failed].sort((a, b) => a.queuedAt - b.queuedAt);
}

/**
 * Enqueues an op, replacing any pending op for the same resource+action
 * (last-write-wins already at queue time). Throws when not eligible.
 */
export async function enqueueOutboxOp(
  op: Pick<OutboxOp, "resource" | "action" | "payload">,
  overrides?: OutboxTable,
): Promise<number> {
  if (!canQueue(op.resource, op.action)) {
    throw new Error(
      `Resource ${op.resource}:${op.action} is not queueable offline`,
    );
  }
  const store = table(overrides);
  const existing = await store.where("status").equals("pending").toArray();
  for (const row of existing) {
    if (
      row.resource === op.resource &&
      row.action === op.action &&
      row.id !== undefined
    ) {
      await store.delete(row.id);
    }
  }
  return store.add({
    ...op,
    queuedAt: Date.now(),
    status: "pending",
  });
}

export async function discardOutboxOp(
  id: number,
  overrides?: OutboxTable,
): Promise<void> {
  await table(overrides).delete(id);
}

/** Moves a failed op back to pending for an explicit user retry. */
export async function requeueOutboxOp(
  id: number,
  overrides?: OutboxTable,
): Promise<void> {
  const store = table(overrides);
  const op = await store.get(id);
  if (!op) return;
  const { error: _error, ...rest } = op;
  await store.put({ ...rest, status: "pending" });
}

export type OutboxExecutor = (op: OutboxOp) => Promise<void>;

export type FlushSummary = {
  succeeded: number;
  failed: Array<{ id?: number; error: string }>;
};

/**
 * Flushes pending ops sequentially. A failed op is marked failed and
 * reported, never retried automatically — 409s from server invariants must
 * be an explicit user decision (retry or discard). Offline errors abort the
 * flush, keeping the remaining ops pending.
 */
export async function flushOutbox(
  execute: OutboxExecutor,
  overrides?: OutboxTable,
): Promise<FlushSummary> {
  const store = table(overrides);
  const pending = (
    await store.where("status").equals("pending").toArray()
  ).sort((a, b) => a.queuedAt - b.queuedAt);
  const summary: FlushSummary = { succeeded: 0, failed: [] };
  for (const op of pending) {
    if (op.id === undefined) continue;
    try {
      await execute(op);
      await store.delete(op.id);
      summary.succeeded += 1;
    } catch (error) {
      if (isOfflineError(error)) {
        // Still offline: stop, everything stays pending.
        break;
      }
      const message =
        error instanceof Error ? error.message : "No se pudo sincronizar.";
      await store.put({ ...op, status: "failed", error: message });
      summary.failed.push({ id: op.id, error: message });
    }
  }
  return summary;
}
