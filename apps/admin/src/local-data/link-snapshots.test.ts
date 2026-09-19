import "fake-indexeddb/auto";
import { afterEach, expect, it, vi } from "vitest";
import { makeConfig } from "@savia/crm-shared/metadata";
import type { RelationDefinition } from "@savia/crm-shared/relations";
import { openLocalStore, type LocalStore } from "./store";
import { createLocalTransport } from "./transport";
let store: LocalStore;
const definition: RelationDefinition = {
  id: "r",
  sourceObject: "policies",
  targetObject: "people",
  sourceLabel: "Policies",
  targetLabel: "People",
  cardinality: "one-to-many",
  storage: "local",
};
const group = {
  definition,
  direction: "outgoing",
  targetObject: "people",
  targetLabel: "People",
  label: "People",
  records: [{ id: "c1", label: "One" }],
  total: 1,
  canEdit: true,
};
async function setup() {
  store = await openLocalStore(crypto.randomUUID());
  await store.refreshManifest(
    ["policies", "people"].map((name) => ({
      name,
      object: {
        name,
        label: name,
        description: "",
        config: makeConfig({ name: { type: "Textbox", label: "Name" } }),
      },
      capability: "read-write",
      schemaVersion: 1,
    })),
  );
  for (const name of ["policies", "people"])
    await store.applyPull(name, {
      documents: [
        {
          id: name === "policies" ? "p1" : "c1",
          name: "One",
          _version: 1,
          created_at: "",
          updated_at: "",
        },
      ],
      cursor: "0",
      hasMore: false,
    });
}
afterEach(async () => {
  vi.unstubAllGlobals();
  await store?.destroy();
});
it("reopens downloaded complete link selections offline without network reads", async () => {
  await setup();
  const network = vi.fn(async () => Response.json({ data: [group] }));
  const transport = createLocalTransport(store, network, async () => {});
  await transport("/api/record-links/policies/p1?perPage=100");
  vi.stubGlobal("navigator", { onLine: false });
  const result = await transport("/api/record-links/policies/p1?perPage=100");
  expect(result.ok).toBe(true);
  expect((await result.json()).data[0].records[0].id).toBe("c1");
  expect(network).toHaveBeenCalledOnce();
});
it("never caches a partial page as a complete offline association", async () => {
  await setup();
  const transport = createLocalTransport(
    store,
    async () => Response.json({ data: [{ ...group, total: 2 }] }),
    async () => {},
  );
  await transport("/api/record-links/policies/p1");
  vi.stubGlobal("navigator", { onLine: false });
  expect((await transport("/api/record-links/policies/p1")).status).toBe(503);
});
it("keeps locally queued links when an earlier server read finishes late", async () => {
  await setup();
  let release!: (response: Response) => void;
  let entered!: () => void;
  const started = new Promise<void>((r) => (entered = r));
  const transport = createLocalTransport(
    store,
    async () => {
      entered();
      return new Promise<Response>((r) => (release = r));
    },
    async () => {},
  );
  const request = transport(
    "/api/record-links/policies/p1?perPage=100&includeRecords=true",
  );
  await started;
  await store.enqueueBundle(
    "policies",
    {
      record: { id: "p1", version: 1, data: { name: "Edited" } },
      relations: [
        { relationId: "r", previousIds: [], rows: [{ data: { name: "New" } }] },
      ],
    },
    [definition],
    crypto.randomUUID(),
  );
  release(Response.json({ data: [{ ...group, records: [], total: 0 }] }));
  const result = await request;
  expect((await result.json()).data[0].records[0].data.name).toBe("New");
  expect(
    (await store.db.linkSnapshots.get(["policies", "p1"]))?.groups[0].ids,
  ).toHaveLength(1);
});
it("does not expose cached child IDs after access to their collection is removed", async () => {
  await setup();
  const transport = createLocalTransport(
    store,
    async () => Response.json({ data: [group] }),
    async () => {},
  );
  await transport("/api/record-links/policies/p1?perPage=100");
  await store.db.collections.delete("people");
  vi.stubGlobal("navigator", { onLine: false });
  const response = await transport("/api/record-links/policies/p1");
  expect(response.status).toBe(403);
  expect(await response.text()).not.toContain("c1");
});
it("preserves complete coverage after filtered and count-only requests and honors offline filters", async () => {
  await setup();
  const other = { ...group, definition: { ...definition, id: "other" } };
  const transport = createLocalTransport(
    store,
    async (path) =>
      Response.json({
        data: path.includes("relationId=")
          ? [group]
          : path.includes("includeRecords=false")
            ? [{ ...group, records: [] }]
            : [group, other],
      }),
    async () => {},
  );
  await transport("/api/record-links/policies/p1?perPage=100");
  await transport("/api/record-links/policies/p1?relationId=r");
  await transport("/api/record-links/policies/p1?includeRecords=false");
  vi.stubGlobal("navigator", { onLine: false });
  const all = await (await transport("/api/record-links/policies/p1")).json();
  expect(all.data).toHaveLength(2);
  expect(all.data[0].records[0]).not.toHaveProperty("data");
  const filtered = await (
    await transport(
      "/api/record-links/policies/p1?relationId=r&direction=outgoing&includeRecords=true",
    )
  ).json();
  expect(filtered.data).toHaveLength(1);
  expect(filtered.data[0].records[0].data.name).toBe("One");
  expect(
    (
      await (
        await transport("/api/record-links/policies/p1?direction=incoming")
      ).json()
    ).data,
  ).toEqual([]);
  const count = await (
    await transport(
      "/api/record-links/policies/p1?relationId=r&includeRecords=false",
    )
  ).json();
  expect(count.data[0].records).toEqual([]);
  expect(count.data[0].total).toBe(1);
});
for (const change of ["authorization", "policy", "parent", "child"] as const)
  it(`rejects a late response after ${change} access changes`, async () => {
    await setup();
    let release!: (response: Response) => void;
    let entered!: () => void;
    const started = new Promise<void>((r) => (entered = r));
    const transport = createLocalTransport(
      store,
      async () => {
        entered();
        return new Promise<Response>((r) => (release = r));
      },
      async () => {},
    );
    const request = transport("/api/record-links/policies/p1?perPage=100");
    await started;
    if (change === "authorization") await store.blockAuthorization("revoked");
    else if (change === "policy") await store.acceptPolicy("new-policy");
    else
      await store.db.collections.delete(
        change === "parent" ? "policies" : "people",
      );
    release(Response.json({ data: [group] }));
    const response = await request;
    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain("c1");
    expect(await store.db.linkSnapshots.count()).toBe(0);
  });
for (const status of [401, 403])
  it(`blocks cached data after an observed ${status}`, async () => {
    await setup();
    const network = vi.fn(async () => Response.json({ data: [group] }));
    const transport = createLocalTransport(store, network, async () => {});
    await transport("/api/record-links/policies/p1?perPage=100");
    network.mockImplementation(async () => new Response(null, { status }));
    expect((await transport("/api/record-links/policies/p1")).status).toBe(403);
    expect(await store.authorizationError()).toBeTruthy();
    vi.stubGlobal("navigator", { onLine: false });
    expect((await transport("/api/record-links/policies/p1")).status).toBe(403);
  });
