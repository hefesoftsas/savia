import "fake-indexeddb/auto";
import { afterEach, expect, it } from "vitest";
import { openLocalStore, type LocalStore } from "./store";
import { syncOnce } from "./sync";
let store: LocalStore;
afterEach(async () => {
  await store?.destroy();
});
it("clears previous projections before replay when policy revision changes", async () => {
  store = await openLocalStore(crypto.randomUUID());
  let revision = 1;
  let pushes = 0;
  const transport = async (path: string) => {
    if (path.endsWith("manifest"))
      return Response.json({
        principalId: "u",
        policyScope: "tenant:1",
        policyRevision: revision,
        collections: [
          {
            name: "people",
            object: { config: { fields: { name: { type: "Textbox" } } } },
            capability: "read-write",
            schemaVersion: 1,
          },
        ],
      });
    if (path.includes("push")) {
      pushes++;
      return Response.json({
        data: {
          id: "a",
          name: "Pending",
          secret: "Old secret",
          created_at: "",
          updated_at: "",
          _version: 2,
        },
      });
    }
    return Response.json({
      documents: [
        {
          id: "a",
          name: "Visible",
          ...(revision === 1 ? { secret: "Old secret" } : {}),
          created_at: "",
          updated_at: "",
          _version: 1,
        },
      ],
      cursor: "cursor",
      hasMore: false,
    });
  };
  await syncOnce(store, transport, "u");
  await store.mutate("people", "update", "a", { name: "Pending" });
  revision = 2;
  await syncOnce(store, transport, "u");
  expect(pushes).toBe(0);
  expect(await store.get("people", "a")).not.toHaveProperty("secret");
  expect((await store.db.outbox.toArray())[0].state).toBe("error");
});
it("removes revoked records even when they have pending local work", async () => {
  store = await openLocalStore(crypto.randomUUID());
  await store.refreshManifest([
    {
      name: "people",
      object: { config: { fields: {} } } as never,
      capability: "read-write",
      schemaVersion: 1,
    },
  ]);
  await store.mutate("people", "create", "a", { name: "Secret" });
  await store.applyPull("people", {
    documents: [],
    removedIds: ["a"],
    cursor: "next",
    hasMore: false,
  });
  expect(await store.get("people", "a")).toBeUndefined();
  expect((await store.db.outbox.toArray())[0].quarantined).toBe(true);
});
it("discarding quarantined work never restores its previous snapshot", async () => {
  store = await openLocalStore(crypto.randomUUID());
  const collection = {
    name: "people",
    object: { config: { fields: {} } } as never,
    capability: "read-write" as const,
    schemaVersion: 1,
  };
  await store.refreshManifest([collection]);
  await store.applyPull("people", {
    documents: [
      {
        id: "a",
        secret: "Hidden",
        created_at: "",
        updated_at: "",
        _version: 1,
      },
    ],
    cursor: "old",
    hasMore: false,
  });
  const mutation = await store.mutate("people", "update", "a", {
    name: "Pending",
  });
  await store.acceptPolicy("new-policy");
  await store.refreshManifest([collection]);
  const queued = (await store.db.outbox.toArray())[0];
  await store.discardMutation(queued.mutationId);
  expect(await store.get("people", "a")).toBeUndefined();
});
it("applies field redaction even when a record has pending work", async () => {
  store = await openLocalStore(crypto.randomUUID());
  await store.refreshManifest([
    {
      name: "people",
      object: { config: { fields: {} } } as never,
      capability: "read-write",
      schemaVersion: 1,
    },
  ]);
  await store.applyPull("people", {
    documents: [
      {
        id: "a",
        name: "Visible",
        secret: "Hidden",
        created_at: "",
        updated_at: "",
        _version: 1,
      },
    ],
    cursor: "old",
    hasMore: false,
  });
  await store.mutate("people", "update", "a", { name: "Pending" });
  await store.applyPull("people", {
    documents: [
      { id: "a", name: "Visible", created_at: "", updated_at: "", _version: 2 },
    ],
    cursor: "new",
    hasMore: false,
  });
  expect(await store.get("people", "a")).not.toHaveProperty("secret");
  expect((await store.db.outbox.toArray())[0].quarantined).toBe(true);
});
it("never overlays quarantined changes when acknowledging a newer permitted edit", async () => {
  store = await openLocalStore(crypto.randomUUID());
  const collection = {
    name: "people",
    object: { config: { fields: {} } } as never,
    capability: "read-write" as const,
    schemaVersion: 1,
  };
  await store.refreshManifest([collection]);
  await store.mutate("people", "create", "a", {
    name: "Old",
    secret: "Hidden",
  });
  const stale = (await store.db.outbox.toArray())[0];
  await store.acceptPolicy("reduced");
  await store.refreshManifest([collection]);
  await store.mutate("people", "update", "a", { name: "Allowed" });
  const fresh = (await store.db.outbox.toArray()).find((m) => !m.quarantined)!;
  const master = {
    id: "a",
    name: "Allowed",
    created_at: "",
    updated_at: "",
    _version: 2,
  };
  await store.acknowledge(fresh, master);
  expect(await store.get("people", "a")).not.toHaveProperty("secret");
  await store.acknowledge(stale, { ...master, secret: "Hidden" });
  expect(await store.get("people", "a")).not.toHaveProperty("secret");
});

it("discarding a new rejected edit does not overlay an older quarantined edit", async () => {
  store = await openLocalStore(crypto.randomUUID());
  const collection = {
    name: "people",
    object: { config: { fields: {} } } as never,
    capability: "read-write" as const,
    schemaVersion: 1,
  };
  await store.refreshManifest([collection]);
  await store.mutate("people", "create", "a", {
    name: "Old",
    secret: "Hidden",
  });
  await store.acceptPolicy("reduced");
  await store.refreshManifest([collection]);
  await store.applyPull("people", {
    documents: [
      { id: "a", name: "Visible", created_at: "", updated_at: "", _version: 2 },
    ],
    cursor: "new",
    hasMore: false,
  });
  await store.mutate("people", "update", "a", { name: "Invalid" });
  const fresh = (await store.db.outbox.toArray()).find((m) => !m.quarantined)!;
  await store.rejectMutation(fresh, "error", "Validation rejected");
  await store.discardMutation(fresh.mutationId);
  expect(await store.get("people", "a")).not.toHaveProperty("secret");
});
