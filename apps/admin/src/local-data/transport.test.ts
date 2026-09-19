import "fake-indexeddb/auto";
import { describe, it, expect, vi } from "vitest";
import { createLocalTransport } from "./transport";
const document = { id: "one", _version: 1, deleted_at: null, name: "Ana" };
function store() {
  return {
    scope: "test",
    db: {
      collections: {
        get: async () => ({
          name: "contacts",
          capability: "read-write",
          object: {
            name: "contacts",
            config: { fields: { name: { type: "text" } } },
          },
        }),
        toArray: async () => [],
      },
      syncState: { get: async () => ({ hydrated: true }) },
    },
    get: async () => document,
    mutate: vi.fn().mockResolvedValue({ ...document, name: "Updated" }),
  };
}
describe("local CRM transport", () => {
  it("reads hydrated record details without HTTP", async () => {
    const network = vi.fn();
    const transport = createLocalTransport(
      store() as never,
      network,
      async () => {},
    );
    const response = await transport("/api/records/contacts/one");
    expect(await response.json()).toEqual({ data: document });
    expect(network).not.toHaveBeenCalled();
  });
  it("acknowledges local edits without waiting for server", async () => {
    const network = vi.fn();
    const transport = createLocalTransport(
      store() as never,
      network,
      async () => {},
    );
    const response = await transport("/api/records/contacts/one", {
      method: "PATCH",
      body: JSON.stringify({ name: "Updated", _version: 1 }),
    });
    expect(response.status).toBe(200);
    expect((await response.json()).data.name).toBe("Updated");
    expect(network).not.toHaveBeenCalled();
  });
  it("rejects traversal before reading local records or forwarding", async () => {
    const network = vi.fn();
    const transport = createLocalTransport(
      store() as never,
      network,
      async () => {},
    );
    expect((await transport("/api/records/%252e%252e/one")).status).toBe(400);
    expect(network).not.toHaveBeenCalled();
  });
});

it("forwards bulk operations without mistaking the reserved name for a record id", async () => {
  const local = store();
  const network = vi.fn().mockResolvedValue(Response.json({ data: [] }));
  const transport = createLocalTransport(
    local as never,
    network,
    async () => {},
  );
  const result = await transport("/api/records/contacts/bulk", {
    method: "POST",
    body: "{}",
  });
  expect(result.ok).toBe(true);
  expect(network).toHaveBeenCalledOnce();
  expect(local.mutate).not.toHaveBeenCalled();
});
it("returns 404 for locally deleted detail records", async () => {
  const local = store();
  local.get = async () => ({ ...document, deleted_at: "deleted" }) as never;
  const network = vi.fn();
  const result = await createLocalTransport(
    local as never,
    network,
    async () => {},
  )("/api/records/contacts/one");
  expect(result.status).toBe(404);
  expect(network).not.toHaveBeenCalled();
});
it("loads complete object metadata online instead of replacing menu layout with manifest-only data", async () => {
  const local = store();
  local.db.collections.toArray = async () =>
    [{ object: { name: "contacts" } }] as never;
  const network = vi.fn().mockResolvedValue(
    Response.json({
      data: [{ name: "contacts" }],
      menuLayout: { groups: ["main"] },
    }),
  );
  const result = await createLocalTransport(
    local as never,
    network,
    async () => {},
  )("/api/objects");
  expect((await result.json()).menuLayout).toEqual({ groups: ["main"] });
  expect(network).toHaveBeenCalledOnce();
});
it("does not turn record-detail endpoints into write routes", async () => {
  const local = store();
  const network = vi
    .fn()
    .mockResolvedValue(new Response(null, { status: 405 }));
  const result = await createLocalTransport(
    local as never,
    network,
    async () => {},
  )("/api/record-detail/contacts/one", {
    method: "PATCH",
    body: JSON.stringify({ name: "Wrong route" }),
  });
  expect(result.status).toBe(405);
  expect(local.mutate).not.toHaveBeenCalled();
});

it("reuses complete metadata on fetch failure even when the browser reports online", async () => {
  const { writeWorkspaceMetadata } = await import("./session");
  const local = store();
  local.scope = "metadata-network-failure";
  await writeWorkspaceMetadata(`${local.scope}:metadata:/api/objects`, {
    data: [{ name: "contacts" }],
    menuLayout: { groups: ["main"] },
  });
  const network = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
  const result = await createLocalTransport(
    local as never,
    network,
    async () => {},
  )("/api/objects");
  expect((await result.json()).menuLayout).toEqual({ groups: ["main"] });
});
it("allows already provisioned bootstrap after network failure", async () => {
  const local = store();
  Object.assign(local.db.collections, { count: async () => 1 });
  const network = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
  const result = await createLocalTransport(
    local as never,
    network,
    async () => {},
  )("/api/bootstrap", { method: "POST" });
  expect(await result.json()).toEqual({ ok: true });
});

it("allows provisioned bootstrap when embedded transport converts a network failure to 503", async () => {
  const local = store();
  Object.assign(local.db.collections, { count: async () => 1 });
  const network = vi
    .fn()
    .mockResolvedValue(Response.json({ error: "Offline" }, { status: 503 }));
  const result = await createLocalTransport(
    local as never,
    network,
    async () => {},
  )("/api/bootstrap", { method: "POST" });
  expect(await result.json()).toEqual({ ok: true });
});

it("boots an already provisioned agency offline through business setup", async () => {
  const local = store();
  Object.assign(local.db.collections, { count: async () => 1 });
  const network = vi
    .fn()
    .mockResolvedValue(Response.json({ error: "Offline" }, { status: 503 }));
  const result = await createLocalTransport(
    local as never,
    network,
    async () => {},
  )("/api/business/setup", { method: "POST" });
  expect(result.status).toBe(200);
  expect(await result.json()).toEqual({ ok: true });
});
it("does not fabricate business setup for an unprovisioned workspace", async () => {
  const local = store();
  Object.assign(local.db.collections, { count: async () => 0 });
  const network = vi
    .fn()
    .mockResolvedValue(Response.json({ error: "Offline" }, { status: 503 }));
  const result = await createLocalTransport(
    local as never,
    network,
    async () => {},
  )("/api/business/setup", { method: "POST" });
  expect(result.status).toBe(503);
});

it("serves hydrated page changes locally with no HTTP or synchronization", async () => {
  const { openLocalStore } = await import("./store");
  const local = await openLocalStore(crypto.randomUUID());
  try {
    await local.refreshManifest([
      {
        name: "contacts",
        capability: "read-write",
        schemaVersion: 1,
        object: {
          name: "contacts",
          config: { fields: { name: { type: "Textbox" } } },
        },
      } as never,
    ]);
    await local.applyPull("contacts", {
      documents: [
        { ...document, created_at: "2026-01-01", updated_at: "2026-01-01" },
      ],
      cursor: "1",
      hasMore: false,
    });
    const network = vi.fn();
    const synchronize = vi.fn();
    const transport = createLocalTransport(local, network, synchronize);
    const first = await transport("/api/records/contacts?page=1&perPage=1");
    const second = await transport("/api/records/contacts?page=2&perPage=1");
    expect((await first.json()).data).toHaveLength(1);
    expect((await second.json()).data).toHaveLength(0);
    expect(network).not.toHaveBeenCalled();
    expect(synchronize).not.toHaveBeenCalled();
  } finally {
    await local.destroy();
  }
});

it("requests only the collection that needs provisioning", async () => {
  const local = store();
  let hydrated = false;
  local.db.syncState.get = async () => ({ hydrated });
  const synchronize = vi.fn(async (_collection?: string) => {
    hydrated = true;
  });
  const network = vi.fn();
  const result = await createLocalTransport(
    local as never,
    network,
    synchronize,
  )("/api/records/contacts/one");
  expect(result.ok).toBe(true);
  expect(synchronize).toHaveBeenCalledExactlyOnceWith("contacts");
  expect(network).not.toHaveBeenCalled();
});

it("schedules post-bootstrap synchronization in the background instead of a full foreground pass", async () => {
  const local = store();
  const foreground = vi.fn();
  const background = vi.fn();
  const network = vi.fn().mockResolvedValue(Response.json({ ok: true }));
  const transport = createLocalTransport(
    local as never,
    network,
    foreground,
    background,
  );
  expect((await transport("/api/bootstrap", { method: "POST" })).ok).toBe(true);
  expect(background).toHaveBeenCalledOnce();
  expect(foreground).not.toHaveBeenCalled();
});

it("caches extension settings metadata offline and invalidates on mutation", async () => {
  const local = store();
  const settingsData = { data: { value: { prefix: "COT-" }, version: 1 } };
  const network = vi.fn().mockResolvedValue(Response.json(settingsData));
  const transport = createLocalTransport(
    local as never,
    network,
    async () => {},
  );

  // 1. First fetch reaches the network and caches to workspace metadata
  const first = await transport(
    "/api/extensions/insurance.quotes/settings",
    { method: "GET" },
  );
  expect(await first.json()).toEqual(settingsData);
  expect(network).toHaveBeenCalledTimes(1);

  // 2. Second fetch returns immediately from local cached metadata without network
  const second = await transport(
    "/api/extensions/insurance.quotes/settings",
    { method: "GET" },
  );
  expect(await second.json()).toEqual(settingsData);
  expect(network).toHaveBeenCalledTimes(1);

  // 3. Mutation invalidates extension metadata cache
  const mutationResponse = Response.json({ ok: true });
  network.mockResolvedValueOnce(mutationResponse);
  await transport("/api/extensions/insurance.quotes/settings", {
    method: "PUT",
    body: JSON.stringify({ value: { prefix: "COT-2-" }, version: 1 }),
  });

  // 4. Subsequent fetch after mutation goes back to the server
  const updatedData = { data: { value: { prefix: "COT-2-" }, version: 2 } };
  network.mockResolvedValueOnce(Response.json(updatedData));
  const third = await transport(
    "/api/extensions/insurance.quotes/settings",
    { method: "GET" },
  );
  expect(await third.json()).toEqual(updatedData);
  expect(network).toHaveBeenCalledTimes(3);
});

