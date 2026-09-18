import "fake-indexeddb/auto";
import { afterEach, expect, it } from "vitest";
import { openLocalStore, type LocalStore } from "./store";
import { syncOnce } from "./sync";
let store: LocalStore;
afterEach(async () => {
  await store?.destroy();
});
it("retries the exact mutation after a lost ACK then delivers dependent updates", async () => {
  store = await openLocalStore(crypto.randomUUID());
  await store.refreshManifest([
    {
      name: "people",
      object: { config: { fields: {} } } as never,
      capability: "read-write",
      schemaVersion: 1,
    },
  ]);
  await store.mutate("people", "create", "a", { name: "First" });
  await store.mutate("people", "update", "a", { name: "Second" });
  const receipts = new Map<string, unknown>();
  let lose = true;
  const ids: string[] = [];
  const transport = async (path: string, init?: RequestInit) => {
    if (path.endsWith("manifest"))
      return Response.json({
        collections: [
          {
            name: "people",
            object: {},
            capability: "read-write",
            schemaVersion: 1,
          },
        ],
      });
    if (path.includes("/pull/"))
      return Response.json({ documents: [], cursor: "1", hasMore: false });
    const m = JSON.parse(String(init?.body));
    ids.push(m.mutationId);
    if (!receipts.has(m.mutationId))
      receipts.set(m.mutationId, {
        id: m.id,
        ...m.data,
        _version: receipts.size + 1,
        created_at: "",
        updated_at: "",
      });
    if (lose) {
      lose = false;
      throw new Error("ACK lost");
    }
    return Response.json({ data: receipts.get(m.mutationId) });
  };
  await expect(syncOnce(store, transport)).rejects.toThrow("ACK lost");
  await syncOnce(store, transport);
  expect(ids[0]).toBe(ids[1]);
  expect(receipts.size).toBe(2);
  expect((await store.get("people", "a"))?.name).toBe("Second");
  expect((await store.status()).pending).toBe(0);
});
it("cancels an in-flight foreground synchronization before persisting a late response", async () => {
  store = await openLocalStore(crypto.randomUUID());
  const original = Object.getOwnPropertyDescriptor(navigator, "locks");
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: {
      request: async (
        _name: string,
        _options: unknown,
        callback: () => Promise<void>,
      ) => callback(),
    },
  });
  let respond!: (r: Response) => void;
  const response = new Promise<Response>((resolve) => {
    respond = resolve;
  });
  const { createSyncCoordinator } = await import("./sync");
  const coordinator = createSyncCoordinator(store, () => response);
  const pending = coordinator.syncNow();
  coordinator.stop();
  respond(Response.json({ collections: [] }));
  try {
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(await store.db.collections.count()).toBe(0);
  } finally {
    if (original) Object.defineProperty(navigator, "locks", original);
    else Reflect.deleteProperty(navigator, "locks");
  }
});
it("revokes cached visibility on auth failure without losing unsynced work or retrying", async () => {
  store = await openLocalStore(crypto.randomUUID());
  await store.refreshManifest([
    {
      name: "people",
      object: { config: { fields: {} } } as never,
      capability: "read-write",
      schemaVersion: 1,
    },
  ]);
  await store.mutate("people", "create", "a", { name: "Private draft" });
  let requests = 0;
  const transport = async () => {
    requests++;
    return new Response("", { status: 401 });
  };
  await expect(syncOnce(store, transport)).rejects.toThrow("401");
  expect(await store.get("people", "a")).toBeUndefined();
  expect(await store.db.collections.count()).toBe(0);
  expect((await store.db.outbox.toArray())[0]?.localSnapshot?.name).toBe(
    "Private draft",
  );
  expect((await store.status()).authorizationError).toBeTruthy();
  await expect(syncOnce(store, transport)).rejects.toThrow("401");
  expect(requests).toBe(1);
});
it.each(["push", "pull"])(
  "blocks authorization when %s returns 403",
  async (route) => {
    store = await openLocalStore(crypto.randomUUID());
    const collections = [
      {
        name: "people",
        object: { config: { fields: {} } } as never,
        capability: "read-write" as const,
        schemaVersion: 1,
      },
    ];
    await store.refreshManifest(collections);
    if (route === "push")
      await store.mutate("people", "create", "a", { name: "Kept" });
    const transport = async (path: string) =>
      path.endsWith("/manifest")
        ? Response.json({ collections })
        : new Response("", { status: 403 });
    await expect(syncOnce(store, transport)).rejects.toThrow("403");
    expect(await store.db.collections.count()).toBe(0);
    expect((await store.status()).authorizationError).toContain("403");
  },
);
it("rejects a manifest for another principal before sending this scope outbox", async () => {
  store = await openLocalStore(crypto.randomUUID());
  const collections = [
    {
      name: "people",
      object: { config: { fields: {} } } as never,
      capability: "read-write" as const,
      schemaVersion: 1,
    },
  ];
  await store.refreshManifest(collections);
  await store.mutate("people", "create", "a", { name: "Private" });
  const paths: string[] = [];
  await expect(
    syncOnce(
      store,
      async (path) => {
        paths.push(path);
        return Response.json({ collections, principalId: "other-user" });
      },
      "expected-user",
    ),
  ).rejects.toThrow("principal");
  expect(paths).toEqual(["/api/local-sync/manifest"]);
  expect(await store.db.records.count()).toBe(0);
  expect((await store.status()).errors).toBe(1);
});
it("halts quota failures and exposes an actionable in-memory error while preserving the cursor", async () => {
  store = await openLocalStore(crypto.randomUUID());
  const original = Object.getOwnPropertyDescriptor(navigator, "locks");
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: {
      request: async (
        _name: string,
        _options: unknown,
        callback: () => Promise<void>,
      ) => callback(),
    },
  });
  const { createSyncCoordinator } = await import("./sync");
  const collections = [
    {
      name: "people",
      object: { config: { fields: {} } },
      capability: "read-write",
      schemaVersion: 1,
    },
  ];
  const transport = async (path: string) =>
    path.endsWith("manifest")
      ? Response.json({ collections })
      : Response.json({
          documents: [
            { id: "a", name: "Remote", created_at: "", updated_at: "" },
          ],
          cursor: "1",
          hasMore: false,
        });
  const fail = () => {
    throw new DOMException("Disk full", "QuotaExceededError");
  };
  store.db.records.hook("creating", fail);
  const coordinator = createSyncCoordinator(store, transport);
  try {
    await expect(coordinator.syncNow()).rejects.toBeTruthy();
    expect((await store.status()).syncError).toContain("storage");
    expect(await store.db.syncState.get("people")).toBeUndefined();
    store.db.records.hook("creating").unsubscribe(fail);
    await coordinator.syncNow();
    expect((await store.status()).syncError).toBeUndefined();
    expect((await store.get("people", "a"))?.name).toBe("Remote");
  } finally {
    coordinator.stop();
    if (original) Object.defineProperty(navigator, "locks", original);
    else Reflect.deleteProperty(navigator, "locks");
  }
});
it.each(["accept", "retry"] as const)(
  "preserves explicit null master from HTTP 409 for %s resolution",
  async (resolution) => {
    store = await openLocalStore(crypto.randomUUID());
    const collections = [
      {
        name: "people",
        object: { config: { fields: {} } } as never,
        capability: "read-write" as const,
        schemaVersion: 1,
      },
    ];
    await store.refreshManifest(collections);
    await store.mutate("people", "update", "missing", { name: "Local draft" });
    const mutation = (await store.db.outbox.toArray())[0]!;
    await syncOnce(store, async (path) => {
      if (path.endsWith("/manifest")) return Response.json({ collections });
      if (path.includes("/push/"))
        return Response.json(
          { master: null, error: { message: "Record was removed" } },
          { status: 409 },
        );
      return Response.json({ documents: [], cursor: "1", hasMore: false });
    });
    expect(
      (await store.db.conflicts.get(mutation.mutationId))?.master,
    ).toBeNull();
    expect((await store.db.outbox.get(mutation.mutationId))?.error).toBe(
      "Record was removed",
    );
    if (resolution === "accept") {
      await store.acceptMaster(mutation.mutationId);
      expect(await store.get("people", "missing")).toBeUndefined();
      expect(await store.db.outbox.count()).toBe(0);
    } else {
      await store.retryWithLocal(mutation.mutationId);
      const retried = (await store.db.outbox.toArray())[0]!;
      expect(retried.action).toBe("create");
      expect(retried.mutationId).not.toBe(mutation.mutationId);
      expect(retried.data?.name).toBe("Local draft");
    }
  },
);

it("hydrates a requested collection without waiting for unrelated collections and coalesces readers", async () => {
  store = await openLocalStore(crypto.randomUUID());
  const original = Object.getOwnPropertyDescriptor(navigator, "locks");
  let chain = Promise.resolve();
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: {
      request: (
        _name: string,
        _options: unknown,
        callback: (lock: object) => Promise<void>,
      ) => {
        const next = chain.then(() => callback({}));
        chain = next.catch(() => undefined);
        return next;
      },
    },
  });
  const collections = ["unrelated", "people"].map((name) => ({
    name,
    object: { config: { fields: {} } },
    capability: "read-only",
    schemaVersion: 1,
  }));
  const calls: string[] = [];
  let unrelatedStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    unrelatedStarted = resolve;
  });
  let resumed!: () => void;
  const backgroundResumed = new Promise<void>((resolve) => {
    resumed = resolve;
  });
  let unrelatedRequests = 0;
  const { createSyncCoordinator } = await import("./sync");
  const coordinator = createSyncCoordinator(store, async (path, init) => {
    calls.push(path);
    if (path.endsWith("manifest")) return Response.json({ collections });
    if (path.includes("/unrelated")) {
      unrelatedStarted();
      if (++unrelatedRequests > 1) resumed();
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("Aborted", "AbortError")),
          { once: true },
        );
      });
    }
    return Response.json({ documents: [], cursor: "complete", hasMore: false });
  });
  try {
    coordinator.start();
    await started;
    await Promise.all([
      coordinator.syncNow("people"),
      coordinator.syncNow("people"),
    ]);
    expect((await store.db.syncState.get("people"))?.hydrated).toBe(true);
    expect(calls.filter((path) => path.includes("/pull/people"))).toHaveLength(
      1,
    );
    const before = calls.length;
    await coordinator.syncNow("people");
    expect(calls).toHaveLength(before);
    await backgroundResumed;
  } finally {
    coordinator.stop();
    if (original) Object.defineProperty(navigator, "locks", original);
    else Reflect.deleteProperty(navigator, "locks");
  }
});
