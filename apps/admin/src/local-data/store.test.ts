import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openLocalStore, type LocalStore } from "./store";
const stores: LocalStore[] = [];
async function open(scope: string = crypto.randomUUID()) {
  const s = await openLocalStore(scope);
  stores.push(s);
  await s.refreshManifest([
    {
      name: "people",
      object: { config: { fields: {} } } as never,
      capability: "read-write",
      schemaVersion: 1,
    },
  ]);
  return s;
}
afterEach(async () => {
  for (const s of stores.splice(0)) await s.destroy();
});
const doc = (id: string, name: string, version = 1) => ({
  id,
  name,
  _version: version,
  created_at: "",
  updated_at: "",
});
describe("durable collection store", () => {
  it("persists records and mutation identities across reload and isolates scopes", async () => {
    const a = await open();
    await a.mutate("people", "create", "a", { name: "Local" });
    const mutation = await a.db.outbox.toArray();
    a.close();
    const reopened = await open(a.scope);
    expect((await reopened.get("people", "a"))?.name).toBe("Local");
    expect(await reopened.db.outbox.toArray()).toEqual(mutation);
    expect(await (await open()).get("people", "a")).toBeUndefined();
  });
  it("writes document and outbox atomically", async () => {
    const s = await open();
    s.db.outbox.hook("creating", () => {
      throw new Error("disk full");
    });
    await expect(
      s.mutate("people", "create", "a", { name: "Lost" }),
    ).rejects.toThrow("disk full");
    expect(await s.get("people", "a")).toBeUndefined();
  });
  it("retains later edits after ACK and rebases their version", async () => {
    const s = await open();
    await s.mutate("people", "create", "a", { name: "First" });
    const first = (await s.db.outbox.toArray())[0]!;
    await s.mutate("people", "update", "a", { name: "Second" });
    await s.acknowledge(first, doc("a", "First", 1));
    expect((await s.get("people", "a"))?.name).toBe("Second");
    const rest = await s.db.outbox.toArray();
    expect(rest).toHaveLength(1);
    expect(rest[0]?.baseVersion).toBe(1);
  });
  it("preserves pending overlays on pull and reset, advancing cursor atomically", async () => {
    const s = await open();
    await s.applyPull("people", {
      documents: [doc("a", "Server"), doc("b", "Old")],
      cursor: "1",
      hasMore: false,
    });
    await s.mutate("people", "update", "a", { name: "Mine" });
    await s.applyPull("people", {
      documents: [doc("a", "Other", 2)],
      cursor: "2",
      hasMore: false,
      reset: true,
    });
    expect((await s.get("people", "a"))?.name).toBe("Mine");
    expect(await s.get("people", "b")).toBeUndefined();
    expect((await s.db.syncState.get("people"))?.cursor).toBe("2");
  });
  it("keeps rejected local work and records master conflict", async () => {
    const s = await open();
    await s.mutate("people", "create", "a", { name: "Mine" });
    const m = (await s.db.outbox.toArray())[0]!;
    await s.rejectMutation(m, "conflict", "Conflict", doc("a", "Theirs"));
    expect((await s.get("people", "a"))?.name).toBe("Mine");
    expect((await s.status()).conflicts).toBe(1);
    expect((await s.db.conflicts.get(m.mutationId))?.master?.name).toBe(
      "Theirs",
    );
  });
});
it("resolves conflict using master while retaining dependent edits", async () => {
  const s = await open();
  await s.mutate("people", "create", "a", { name: "First" });
  const first = (await s.db.outbox.toArray())[0]!;
  await s.mutate("people", "update", "a", { name: "Later" });
  await s.rejectMutation(first, "conflict", "Conflict", doc("a", "Master", 4));
  await s.acceptMaster(first.mutationId);
  expect((await s.get("people", "a"))?.name).toBe("Later");
  expect((await s.db.outbox.toArray())[0]?.baseVersion).toBe(4);
  expect(await s.db.conflicts.count()).toBe(0);
});
it("retries local conflict with fresh identity and master version", async () => {
  const s = await open();
  await s.mutate("people", "update", "a", { name: "Mine" });
  const first = (await s.db.outbox.toArray())[0]!;
  await s.rejectMutation(first, "conflict", "Conflict", doc("a", "Master", 4));
  await s.retryWithLocal(first.mutationId);
  const next = (await s.db.outbox.toArray())[0]!;
  expect(next.mutationId).not.toBe(first.mutationId);
  expect(next.baseVersion).toBe(4);
  expect(next.state).toBe("pending");
  expect((await s.get("people", "a"))?.name).toBe("Mine");
});
it("retains delete queued after create acknowledgement", async () => {
  const s = await open();
  await s.mutate("people", "create", "a", { name: "First" });
  const first = (await s.db.outbox.toArray())[0]!;
  await s.mutate("people", "delete", "a");
  await s.acknowledge(first, doc("a", "First", 1));
  expect((await s.get("people", "a"))?.deleted_at).toBeTruthy();
  expect((await s.db.outbox.toArray())[0]?.action).toBe("delete");
});
it("does not advance the cursor when the document transaction fails", async () => {
  const s = await open();
  await s.applyPull("people", {
    documents: [doc("a", "First")],
    cursor: "1",
    hasMore: false,
  });
  s.db.records.hook("creating", () => {
    throw new Error("disk full");
  });
  await expect(
    s.applyPull("people", {
      documents: [doc("b", "Second")],
      cursor: "2",
      hasMore: false,
    }),
  ).rejects.toThrow("disk full");
  expect((await s.db.syncState.get("people"))?.cursor).toBe("1");
});
it("keeps revoked edits as errors and rejects writes without permission", async () => {
  const s = await open();
  await s.mutate("people", "create", "a", { name: "Mine" });
  await s.refreshManifest([]);
  expect((await s.status()).errors).toBe(1);
  expect((await s.db.outbox.toArray())[0]?.data?.name).toBe("Mine");
  expect(await s.get("people", "a")).toBeUndefined();
  await expect(s.mutate("people", "create", "b", {})).rejects.toThrow(
    "not writable",
  );
});
it("accepts a missing server record without silently dropping a dependent edit", async () => {
  const s = await open();
  await s.mutate("people", "update", "a", { name: "First" });
  const first = (await s.db.outbox.toArray())[0]!;
  await s.mutate("people", "update", "a", { name: "Later" });
  await s.rejectMutation(first, "conflict", "Missing", null);
  await s.acceptMaster(first.mutationId);
  expect((await s.get("people", "a"))?.name).toBe("Later");
  expect((await s.status()).conflicts).toBe(1);
  const next = (await s.db.outbox.toArray())[0]!;
  await s.retryWithLocal(next.mutationId);
  expect((await s.db.outbox.toArray())[0]?.action).toBe("create");
});
it("discards a rejected update and replays later edits over its before image", async () => {
  const s = await open();
  await s.applyPull("people", {
    documents: [{ ...doc("a", "Server"), phone: "old" }],
    cursor: "1",
    hasMore: false,
  });
  await s.mutate("people", "update", "a", { name: "Rejected" });
  const first = (await s.db.outbox.toArray())[0]!;
  await s.mutate("people", "update", "a", { phone: "new" });
  await s.rejectMutation(first, "error", "Invalid name");
  await s.discardMutation(first.mutationId);
  expect((await s.get("people", "a"))?.name).toBe("Server");
  expect((await s.get("people", "a"))?.phone).toBe("new");
  expect((await s.status()).pending).toBe(1);
});
it("retries corrected terminal errors with a new identity and retains later edits", async () => {
  const s = await open();
  await s.mutate("people", "create", "a", { name: "Bad" });
  const first = (await s.db.outbox.toArray())[0]!;
  await s.mutate("people", "update", "a", { phone: "new" });
  await s.rejectMutation(first, "error", "Invalid name");
  await s.retryMutation(first.mutationId, { name: "Good" });
  const all = await s.db.outbox.orderBy("sequence").toArray();
  expect(all[0]?.mutationId).not.toBe(first.mutationId);
  expect(all[0]?.data?.name).toBe("Good");
  expect((await s.get("people", "a"))?.phone).toBe("new");
  expect((await s.get("people", "a"))?.name).toBe("Good");
});
it("blocks dependent edits after discarding their rejected create", async () => {
  const s = await open();
  await s.mutate("people", "create", "a", { name: "Bad" });
  const first = (await s.db.outbox.toArray())[0]!;
  await s.mutate("people", "update", "a", { phone: "Kept" });
  await s.rejectMutation(first, "error", "Invalid");
  await s.discardMutation(first.mutationId);
  expect((await s.get("people", "a"))?.phone).toBe("Kept");
  const next = (await s.db.outbox.toArray())[0]!;
  expect(next.state).toBe("error");
  await s.retryMutation(next.mutationId, { name: "Corrected" });
  const retried = (await s.db.outbox.toArray())[0]!;
  expect(retried.action).toBe("create");
  expect(retried.data).toEqual({ phone: "Kept", name: "Corrected" });
});
it("restores retained drafts only after a new authenticated manifest grants access", async () => {
  const s = await open();
  await s.mutate("people", "create", "a", { name: "Private" });
  const manifest = await s.db.collections.toArray();
  await s.blockAuthorization("HTTP 403");
  expect(await s.get("people", "a")).toBeUndefined();
  await s.resumeAuthorization();
  await s.refreshManifest(manifest);
  expect((await s.get("people", "a"))?.name).toBe("Private");
  const first = (await s.db.outbox.toArray())[0]!;
  expect(first.state).toBe("error");
  await s.retryMutation(first.mutationId, { name: "Corrected" });
  await s.refreshManifest(manifest);
  expect((await s.get("people", "a"))?.name).toBe("Corrected");
});
it("requires explicit server restore rather than repeatedly retrying a tombstoned master", async () => {
  const s = await open();
  await s.mutate("people", "update", "a", { name: "Mine" });
  const mutation = (await s.db.outbox.toArray())[0]!;
  await s.rejectMutation(mutation, "conflict", "Deleted", {
    ...doc("a", "Server", 4),
    deleted_at: "2026-01-01",
  });
  await expect(s.retryWithLocal(mutation.mutationId)).rejects.toThrow(
    "restore",
  );
  expect((await s.status()).conflicts).toBe(1);
  expect((await s.get("people", "a"))?.name).toBe("Mine");
});
it("reindexes missing field values when collection schema changes", async () => {
  const s = await open();
  await s.applyPull("people", {
    documents: [doc("a", "Server")],
    cursor: "1",
    hasMore: false,
  });
  const before = (await s.db.records.get(["people", "a"]))!;
  await s.refreshManifest([
    {
      name: "people",
      object: { config: { fields: { new_field: { type: "text" } } } } as never,
      capability: "read-write",
      schemaVersion: 2,
    },
  ]);
  const after = (await s.db.records.get(["people", "a"]))!;
  expect(after.sortKeys!.length).toBeGreaterThan(before.sortKeys!.length);
});

describe("collection query changes", () => {
  it("reports same-count edits from another connection without refreshing other collections or heartbeat pulls", async () => {
    const s = await open();
    await s.refreshManifest([
      {
        name: "people",
        object: { config: { fields: {} } } as never,
        capability: "read-write",
        schemaVersion: 1,
      },
      {
        name: "policies",
        object: { config: { fields: {} } } as never,
        capability: "read-write",
        schemaVersion: 1,
      },
    ]);
    await s.applyPull("people", {
      documents: [doc("a", "Before")],
      cursor: "1",
      hasMore: false,
    });
    const changes: Array<{
      changed: Set<string>;
      current: Set<string>;
      authorizationError?: string;
    }> = [];
    const unsubscribe = s.subscribeQueryChanges((change) =>
      changes.push(change),
    );
    try {
      await vi.waitFor(() => expect(changes).toHaveLength(1));
      changes.length = 0;
      const other = await openLocalStore(s.scope);
      try {
        await other.applyPull("people", {
          documents: [doc("a", "After", 2)],
          cursor: "2",
          hasMore: false,
        });
        await vi.waitFor(() => expect(changes).toHaveLength(1));
        expect([...changes[0]!.changed]).toEqual(["people"]);
        changes.length = 0;
        await other.applyPull("people", {
          documents: [],
          cursor: "2",
          hasMore: false,
        });
        await other.db.outbox.add({
          mutationId: "error",
          collection: "people",
          id: "a",
          action: "update",
          sequence: 1,
          state: "error",
        });
        await new Promise((resolve) => setTimeout(resolve, 80));
        expect(changes).toHaveLength(0);
        await other.blockAuthorization("Session expired");
        await vi.waitFor(() =>
          expect(changes.at(-1)?.authorizationError).toBe("Session expired"),
        );
        expect(changes.at(-1)?.current.size).toBe(0);
      } finally {
        other.close();
      }
    } finally {
      unsubscribe();
    }
  });
});

it("persists a new data revision for same-count writes but not empty or protected pulls", async () => {
  const s = await open();
  const revision = async () =>
    (await s.db.syncState.get("people"))?.dataRevision;
  await s.applyPull("people", {
    documents: [doc("a", "Before")],
    cursor: "1",
    hasMore: false,
  });
  const first = await revision();
  expect(first).toEqual(expect.any(String));
  await s.applyPull("people", { documents: [], cursor: "2", hasMore: false });
  expect(await revision()).toBe(first);
  await s.applyPull("people", {
    documents: [doc("a", "After", 2)],
    cursor: "3",
    hasMore: false,
  });
  const second = await revision();
  expect(second).not.toBe(first);
  await s.mutate("people", "update", "a", { name: "Local" }, 2);
  const local = await revision();
  expect(local).not.toBe(second);
  await s.applyPull("people", {
    documents: [doc("a", "Protected", 3)],
    cursor: "4",
    hasMore: false,
  });
  expect(await revision()).toBe(local);
  expect((await s.db.syncState.get("people"))?.cursor).toBe("4");
});

it("rolls back record, outbox and data revision together when revision persistence fails", async () => {
  const s = await open();
  await s.applyPull("people", {
    documents: [doc("a", "Before")],
    cursor: "1",
    hasMore: false,
  });
  const before = (await s.db.syncState.get("people"))?.dataRevision;
  const reject = () => {
    throw new Error("Revision write failed");
  };
  s.db.syncState.hook("updating", reject);
  await expect(
    s.mutate("people", "update", "a", { name: "Unsaved" }, 1),
  ).rejects.toThrow("Revision write failed");
  s.db.syncState.hook("updating").unsubscribe(reject);
  expect((await s.get("people", "a"))?.name).toBe("Before");
  expect(await s.db.outbox.count()).toBe(0);
  expect((await s.db.syncState.get("people"))?.dataRevision).toBe(before);
});

it.each([
  "acknowledge",
  "accept-master",
  "accept-deleted",
  "discard",
  "retry",
  "reset",
  "schema",
])(
  "advances the data revision when %s changes visible records or indexes",
  async (action) => {
    const s = await open();
    await s.applyPull("people", {
      documents: [doc("a", "Server")],
      cursor: "1",
      hasMore: false,
    });
    if (!["reset", "schema"].includes(action))
      await s.mutate("people", "update", "a", { name: "Local" }, 1);
    const mutation = (await s.db.outbox.toArray())[0];
    if (action.startsWith("accept"))
      await s.rejectMutation(
        mutation,
        "conflict",
        "Conflict",
        action === "accept-deleted" ? null : doc("a", "Master", 2),
      );
    if (["discard", "retry"].includes(action))
      await s.rejectMutation(mutation, "error", "Invalid");
    const before = (await s.db.syncState.get("people"))!.dataRevision;
    if (action === "acknowledge")
      await s.acknowledge(mutation, doc("a", "Acknowledged", 2));
    if (action.startsWith("accept")) await s.acceptMaster(mutation.mutationId);
    if (action === "discard") await s.discardMutation(mutation.mutationId);
    if (action === "retry")
      await s.retryMutation(mutation.mutationId, { name: "Corrected" });
    if (action === "reset")
      await s.applyPull("people", {
        documents: [],
        cursor: "2",
        hasMore: false,
        reset: true,
      });
    if (action === "schema")
      await s.refreshManifest([
        {
          name: "people",
          object: {
            config: { fields: { added: { type: "Textbox" } } },
          } as never,
          capability: "read-write",
          schemaVersion: 2,
        },
      ]);
    const after = (await s.db.syncState.get("people"))!.dataRevision;
    expect(after).toEqual(expect.any(String));
    expect(after).not.toBe(before);
  },
);

it("removes revoked revisions and gives restored local snapshots a fresh revision", async () => {
  const s = await open();
  await s.mutate("people", "create", "a", { name: "Local" });
  const first = (await s.db.syncState.get("people"))!.dataRevision;
  await s.refreshManifest([]);
  expect(await s.db.syncState.get("people")).toBeUndefined();
  await s.refreshManifest([
    {
      name: "people",
      object: { config: { fields: {} } } as never,
      capability: "read-write",
      schemaVersion: 1,
    },
  ]);
  expect((await s.get("people", "a"))?.name).toBe("Local");
  const restored = (await s.db.syncState.get("people"))!.dataRevision;
  expect(restored).toEqual(expect.any(String));
  expect(restored).not.toBe(first);
  await s.blockAuthorization("Forbidden");
  expect(await s.db.syncState.get("people")).toBeUndefined();
});

it("adopts a legacy hydrated replica with no revision on its first empty pull", async () => {
  const s = await open();
  await s.applyPull("people", {
    documents: [doc("a", "Unchanged")],
    cursor: "legacy",
    hasMore: false,
  });
  await s.db.syncState.update("people", { dataRevision: undefined });
  const record = await s.get("people", "a");
  await s.applyPull("people", {
    documents: [],
    cursor: "legacy",
    hasMore: false,
  });
  const adopted = (await s.db.syncState.get("people"))!;
  expect(adopted.dataRevision).toEqual(expect.any(String));
  expect(adopted.hydrated).toBe(true);
  expect(await s.get("people", "a")).toEqual(record);
  await s.applyPull("people", {
    documents: [],
    cursor: "legacy",
    hasMore: false,
  });
  expect((await s.db.syncState.get("people"))?.dataRevision).toBe(
    adopted.dataRevision,
  );
});
