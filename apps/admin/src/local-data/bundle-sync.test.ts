import "fake-indexeddb/auto";
import { afterEach, expect, it } from "vitest";
import { makeConfig } from "@savia/crm-shared/metadata";
import type { RelationDefinition } from "@savia/crm-shared/relations";
import { openLocalStore, type LocalStore } from "./store";
import { syncOnce, resolveQueuedBundle } from "./sync";
let store: LocalStore;
const definitions: RelationDefinition[] = [
  {
    id: "beneficiaries",
    sourceObject: "policies",
    targetObject: "people",
    sourceLabel: "Policies",
    targetLabel: "People",
    cardinality: "one-to-many",
    storage: "local",
    version: 1,
  },
];
const manifest = ["policies", "people"].map((name) => ({
  name,
  object: {
    name,
    label: name,
    description: "",
    config: makeConfig({
      name: { type: "Textbox", label: "Name", required: true },
    }),
  },
  capability: "read-write" as const,
  schemaVersion: 1,
}));
async function setup() {
  store = await openLocalStore(crypto.randomUUID());
  await store.refreshManifest(manifest);
  for (const c of manifest)
    await store.applyPull(c.name, {
      documents: [],
      cursor: "0",
      hasMore: false,
    });
}
afterEach(async () => {
  await store?.destroy();
});
it("replays one immutable bundle after a lost response and acknowledges every local member", async () => {
  await setup();
  const key = crypto.randomUUID();
  const parent = await store.enqueueBundle(
    "policies",
    {
      record: { data: { name: "Policy" } },
      relations: [
        {
          relationId: "beneficiaries",
          rows: [{ data: { name: "Beneficiary" } }],
        },
      ],
    },
    definitions,
    key,
  );
  const bodies: string[] = [];
  let lose = true;
  const transport = async (path: string, init?: RequestInit) => {
    expect(new Headers(init?.headers).get("X-Savia-Sync-Principal")).toBe(
      "actor",
    );
    if (path.endsWith("/manifest"))
      return Response.json({ collections: manifest, principalId: "actor" });
    if (path.includes("/pull/"))
      return Response.json({ documents: [], cursor: "1", hasMore: false });
    expect(path).toBe("/api/record-bundles/policies");
    expect(new Headers(init?.headers).get("Idempotency-Key")).toBe(key);
    bodies.push(String(init?.body));
    const input = JSON.parse(String(init?.body));
    if (lose) {
      lose = false;
      throw new Error("lost ACK");
    }
    return Response.json({
      data: { ...input.record.data, id: input.record.clientId, _version: 1 },
      related: [
        {
          relationId: "beneficiaries",
          records: input.relations[0].rows.map((row: any) => ({
            ...row.data,
            id: row.clientId,
            _version: 1,
          })),
        },
      ],
    });
  };
  await expect(syncOnce(store, transport, "actor")).rejects.toThrow("lost ACK");
  expect(await store.db.outbox.count()).toBe(1);
  await syncOnce(store, transport, "actor");
  expect(bodies[1]).toBe(bodies[0]);
  expect(await store.db.outbox.count()).toBe(0);
  expect((await store.get("policies", parent.id))?._version).toBe(1);
  const child = await store.db.records
    .where("collection")
    .equals("people")
    .first();
  expect(child?.document.name).toBe("Beneficiary");
  expect(child?.document._localPending).toBeUndefined();
});
it("keeps the complete optimistic bundle when the server rejects a child", async () => {
  await setup();
  const parent = await store.enqueueBundle(
    "policies",
    {
      record: { data: { name: "Policy" } },
      relations: [
        {
          relationId: "beneficiaries",
          rows: [{ data: { name: "Beneficiary" } }],
        },
      ],
    },
    definitions,
    crypto.randomUUID(),
  );
  const transport = async (path: string) =>
    path.endsWith("/manifest")
      ? Response.json({ collections: manifest })
      : path.includes("/pull/")
        ? Response.json({ documents: [], cursor: "1", hasMore: false })
        : Response.json({ error: "Child changed" }, { status: 409 });
  await syncOnce(store, transport);
  expect((await store.db.outbox.toArray())[0].state).toBe("conflict");
  expect((await store.get("policies", parent.id))?.name).toBe("Policy");
  expect(await store.db.records.count()).toBe(2);
});
it("resolves a rejected bundle only using fresh authenticated remote records and links", async () => {
  await setup();
  await store.applyPull("policies", {
    documents: [
      { id: "p1", name: "Before", _version: 1, created_at: "", updated_at: "" },
    ],
    cursor: "1",
    hasMore: false,
  });
  const key = crypto.randomUUID();
  await store.enqueueBundle(
    "policies",
    {
      record: { id: "p1", version: 1, data: { name: "Local" } },
      relations: [{ relationId: "beneficiaries", previousIds: [], rows: [] }],
    },
    definitions,
    key,
  );
  const mutation = (await store.db.outbox.get(key))!;
  await store.rejectMutation(mutation, "conflict", "Changed");
  const visited: string[] = [];
  const network = async (path: string, init?: RequestInit) => {
    visited.push(path);
    expect(new Headers(init?.headers).get("X-Savia-Sync-Principal")).toBe(
      "actor",
    );
    if (path.endsWith("/manifest"))
      return Response.json({ collections: manifest, principalId: "actor" });
    if (path.includes("/record-links/"))
      return Response.json({
        data: [{ definition: definitions[0], records: [], total: 0 }],
      });
    return Response.json({ data: { id: "p1", name: "Remote", _version: 9 } });
  };
  await resolveQueuedBundle(store, network, "actor", key, "local");
  const next = (await store.db.outbox.toArray())[0];
  expect(next.mutationId).not.toBe(key);
  expect(next.bundle?.input.record.version).toBe(9);
  expect(next.bundle?.input.record.data.name).toBe("Local");
  expect(visited).toContain("/api/records/policies/p1");
});
it("replays the original receipt after a lost acknowledgement and same-policy 401 renewal", async () => {
  await setup();
  let attempts = 0;
  const requests: Array<{ key: string | null; body: string }> = [];
  const network = async (path: string, init?: RequestInit) => {
    if (path.endsWith("/manifest"))
      return Response.json({
        collections: manifest,
        principalId: "actor",
        policyScope: "tenant",
        policyRevision: 7,
      });
    if (path.includes("/pull/"))
      return Response.json({ documents: [], cursor: "1", hasMore: false });
    expect(new Headers(init?.headers).get("X-Savia-Policy-Revision")).toBe("7");
    requests.push({
      key: new Headers(init?.headers).get("Idempotency-Key"),
      body: String(init?.body),
    });
    attempts++;
    if (attempts === 1) throw new Error("lost acknowledgement");
    if (attempts === 2)
      return Response.json({ error: "expired" }, { status: 401 });
    const input = JSON.parse(String(init?.body));
    return Response.json({
      data: {
        ...input.record.data,
        id: input.record.clientId,
        created_at: "",
        updated_at: "",
        _version: 1,
      },
      related: [
        {
          relationId: "beneficiaries",
          records: input.relations[0].rows.map((row: any) => ({
            ...row.data,
            id: row.clientId,
            created_at: "",
            updated_at: "",
            _version: 1,
          })),
        },
      ],
    });
  };
  await syncOnce(store, network, "actor");
  const key = crypto.randomUUID();
  await store.enqueueBundle(
    "policies",
    {
      record: { data: { name: "Policy" } },
      relations: [
        { relationId: "beneficiaries", rows: [{ data: { name: "Person" } }] },
      ],
    },
    definitions,
    key,
  );
  await expect(syncOnce(store, network, "actor")).rejects.toThrow(
    "lost acknowledgement",
  );
  await expect(syncOnce(store, network, "actor")).rejects.toThrow("401");
  expect(await store.db.records.count()).toBe(0);
  expect((await store.db.outbox.get(key))?.state).toBe("pending");
  expect((await store.db.outbox.get(key))?.quarantined).not.toBe(true);
  const scope = store.scope;
  store.close();
  store = await openLocalStore(scope);
  await store.resumeAuthorization();
  await syncOnce(store, network, "actor");
  expect(requests).toEqual(Array(3).fill(requests[0]));
  expect(requests[0].key).toBe(key);
  expect(await store.db.outbox.count()).toBe(0);
  expect(await store.db.records.count()).toBe(2);
});
it("fetches newly linked server children before rebasing their complete selection", async () => {
  await setup();
  const parent = {
    id: "p1",
    name: "Before",
    _version: 1,
    created_at: "",
    updated_at: "",
  };
  await store.applyPull("policies", {
    documents: [parent],
    cursor: "1",
    hasMore: false,
  });
  const key = crypto.randomUUID();
  await store.enqueueBundle(
    "policies",
    {
      record: { id: "p1", version: 1, data: { name: "Local" } },
      relations: [{ relationId: "beneficiaries", previousIds: [], rows: [] }],
    },
    definitions,
    key,
  );
  await store.rejectMutation(
    (await store.db.outbox.get(key))!,
    "conflict",
    "New link",
  );
  const visited: string[] = [];
  const network = async (path: string) => {
    visited.push(path);
    if (path.endsWith("/manifest"))
      return Response.json({ collections: manifest, principalId: "actor" });
    if (path.includes("/record-links/"))
      return Response.json({
        data: [
          {
            definition: definitions[0],
            direction: "outgoing",
            targetObject: "people",
            targetLabel: "People",
            label: "People",
            records: [{ id: "fresh-b", label: "Fresh B" }],
            total: 1,
            canEdit: true,
          },
        ],
      });
    if (path === "/api/records/people/fresh-b")
      return Response.json({
        data: {
          id: "fresh-b",
          name: "Fresh B",
          _version: 4,
          created_at: "",
          updated_at: "",
        },
      });
    return Response.json({ data: { ...parent, _version: 3 } });
  };
  await resolveQueuedBundle(store, network, "actor", key, "local");
  expect(visited).toContain("/api/records/people/fresh-b");
  const retry = (await store.db.outbox.toArray())[0];
  expect(retry.bundle?.input.relations[0].previousIds).toEqual(["fresh-b"]);
  expect(
    retry.bundle?.members.find((m) => m.id === "fresh-b")?.before?._version,
  ).toBe(4);
});
it("resolves without fetching unrelated remote or read-only relation records", async () => {
  await setup();
  const parent = {
    id: "p1",
    name: "Before",
    _version: 1,
    created_at: "",
    updated_at: "",
  };
  await store.applyPull("policies", {
    documents: [parent],
    cursor: "1",
    hasMore: false,
  });
  const key = crypto.randomUUID();
  await store.enqueueBundle(
    "policies",
    {
      record: { id: parent.id, version: 1, data: { name: "Local" } },
      relations: [{ relationId: "beneficiaries", previousIds: [], rows: [] }],
    },
    definitions,
    key,
  );
  await store.rejectMutation(
    (await store.db.outbox.get(key))!,
    "conflict",
    "Changed",
  );
  const visited: string[] = [];
  const groups = [
    {
      definition: definitions[0],
      targetObject: "people",
      records: [],
      total: 0,
      canEdit: true,
    },
    {
      definition: {
        ...definitions[0],
        id: "remote",
        targetObject: "remote_objects",
        storage: "native",
      },
      targetObject: "remote_objects",
      records: [{ id: "remote-id", label: "Remote" }],
      total: 1,
      canEdit: false,
    },
    {
      definition: {
        ...definitions[0],
        id: "read-only",
        targetObject: "read_only_objects",
      },
      targetObject: "read_only_objects",
      records: [{ id: "read-only-id", label: "Read-only" }],
      total: 1,
      canEdit: false,
    },
  ].map((group) => ({
    ...group,
    direction: "outgoing",
    label: group.targetObject,
    targetLabel: group.targetObject,
  }));
  const network = async (path: string) => {
    visited.push(path);
    if (path.endsWith("/manifest"))
      return Response.json({
        collections: [
          ...manifest,
          {
            ...manifest[1],
            name: "read_only_objects",
            capability: "read-only",
          },
        ],
        principalId: "actor",
      });
    if (path.includes("/record-links/")) return Response.json({ data: groups });
    if (path === "/api/records/policies/p1")
      return Response.json({ data: { ...parent, _version: 2 } });
    throw new Error(`Unrelated record must not be fetched: ${path}`);
  };
  await resolveQueuedBundle(store, network, "actor", key, "local");
  expect(visited.filter((path) => path.startsWith("/api/records/"))).toEqual([
    "/api/records/policies/p1",
  ]);
  const retry = (await store.db.outbox.toArray())[0];
  expect(retry.mutationId).not.toBe(key);
  expect(
    retry.bundle?.groups.find((group) => group.definition.id === "read-only")
      ?.ids,
  ).toEqual(["read-only-id"]);
  expect(
    retry.bundle?.groups.some((group) => group.definition.id === "remote"),
  ).toBe(false);
});
