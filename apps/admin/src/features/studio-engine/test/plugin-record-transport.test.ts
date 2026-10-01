import "fake-indexeddb/auto";
import { afterEach, expect, it, vi } from "vitest";
import { openLocalStore } from "@/local-data/store";
import { createLocalTransport } from "@/local-data/transport";
import { setStudioRuntime } from "../runtime";
import { pluginRecordFetch } from "../plugin-record-transport";
afterEach(() => setStudioRuntime({ embedded: false }));
it("returns the durable mutation identity and keeps offline edits after reopening", async () => {
  const store = await openLocalStore(crypto.randomUUID());
  try {
    await store.refreshManifest([
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
    await store.applyPull("contacts", {
      documents: [],
      cursor: "1",
      hasMore: false,
    });
    const network = vi.fn().mockRejectedValue(new Error("offline"));
    setStudioRuntime({
      embedded: false,
      pluginTransport: network,
      localWorkspace: {
        store,
        transport: createLocalTransport(store, network, async () => {}),
      } as never,
    });
    const receipt = await pluginRecordFetch<any>(
      "/api/records/contacts",
      { method: "POST", body: JSON.stringify({ name: "Offline" }) },
      "local-first",
    );
    expect(receipt.local).toBe(true);
    expect(receipt.mutationId).toEqual(expect.any(String));
    expect(await store.db.outbox.get(receipt.mutationId)).toMatchObject({
      id: receipt.data.id,
      state: "pending",
    });
    expect(network).not.toHaveBeenCalled();
    const reopened = await pluginRecordFetch<any>(
      `/api/records/contacts/${receipt.data.id}`,
      {},
      "local-first",
    );
    expect(reopened.data.name).toBe("Offline");
    vi.spyOn(store, "mutateWithReceipt").mockRejectedValueOnce(
      new Error("quota"),
    );
    await expect(
      pluginRecordFetch(
        "/api/records/contacts",
        { method: "POST", body: "{}" },
        "local-first",
      ),
    ).rejects.toThrow("quota");
    expect(await store.db.outbox.count()).toBe(1);
  } finally {
    await store.destroy();
  }
});
it.each([
  "/api/files",
  "/api/extensions/x/settings",
  "/api/extensions/x/actions/pay",
  "/api/records/contacts/bulk",
  "/api/records/%252e%252e/id",
  "/api/records/contacts/../files",
  "/api/records/contacts?x=1#bad",
])("rejects opt-in operations outside record CRUD: %s", async (path) => {
  const transport = vi.fn();
  setStudioRuntime({
    embedded: false,
    pluginTransport: transport,
    localWorkspace: { transport } as never,
  });
  await expect(
    pluginRecordFetch(path, { method: "POST" }, "local-first"),
  ).rejects.toThrow();
  expect(transport).not.toHaveBeenCalled();
});
it("keeps unmarked legacy requests on the network", async () => {
  const network = vi
    .fn()
    .mockResolvedValue(Response.json({ data: { id: "server" } }));
  const local = vi.fn();
  setStudioRuntime({
    embedded: false,
    pluginTransport: network,
    localWorkspace: { transport: local } as never,
  });
  expect(
    await pluginRecordFetch("/api/records/contacts", { method: "POST" }),
  ).toEqual({ data: { id: "server" } });
  expect(local).not.toHaveBeenCalled();
});
