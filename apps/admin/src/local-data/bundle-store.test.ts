import "fake-indexeddb/auto";
import { afterEach, expect, it } from "vitest";
import { openLocalStore, type LocalStore } from "./store";
import type { RelationDefinition } from "@savia/crm-shared/relations";
const stores: LocalStore[] = [];
const definition: RelationDefinition = {
  id: "rel",
  sourceObject: "parents",
  targetObject: "children",
  sourceLabel: "Parents",
  targetLabel: "Children",
  storage: "local",
  cardinality: "one-to-many",
};
const manifest = ["parents", "children"].map((name) => ({
  name,
  object: { config: { fields: {} } } as never,
  capability: "read-write" as const,
  schemaVersion: 1,
}));
async function setup() {
  const s = await openLocalStore(crypto.randomUUID());
  stores.push(s);
  await s.refreshManifest(manifest);
  for (const collection of ["parents", "children"])
    await s.applyPull(collection, {
      documents: [],
      cursor: "1",
      hasMore: false,
    });
  return s;
}
const input = () => ({
  record: { data: {} },
  relations: [{ relationId: "rel", rows: [{ data: {} }] }],
});
afterEach(async () => {
  for (const s of stores.splice(0)) await s.destroy();
});
it("rolls records, links and outbox back together on storage failure", async () => {
  const s = await setup();
  s.db.outbox.hook("creating", () => {
    throw new Error("disk full");
  });
  await expect(
    s.enqueueBundle("parents", input(), [definition], "op"),
  ).rejects.toThrow("disk full");
  expect(await s.db.records.count()).toBe(0);
  expect(await s.db.linkSnapshots.count()).toBe(0);
});
it("persists immutable bundle identities and protects children from pull resets", async () => {
  const s = await setup();
  const parent = await s.enqueueBundle("parents", input(), [definition], "op");
  const mutation = (await s.db.outbox.get("op"))!;
  const child = mutation.bundle!.members[1];
  await s.applyPull("children", {
    documents: [{ ...child.document, changed: true }],
    cursor: "2",
    hasMore: false,
    reset: true,
  });
  expect(await s.get("children", child.id)).toEqual(child.document);
  await expect(s.mutate("children", "update", child.id, {})).rejects.toThrow(
    "pending bundle",
  );
  s.close();
  const reopened = await openLocalStore(s.scope);
  stores.push(reopened);
  expect(await reopened.db.outbox.get("op")).toEqual(mutation);
  expect(
    (await reopened.db.linkSnapshots.get(["parents", parent.id]))?.groups[0]
      .ids,
  ).toEqual([child.id]);
});
it("marks the entire operation rejected on child revocation and restores optimistic members", async () => {
  const s = await setup();
  await s.enqueueBundle("parents", input(), [definition], "op");
  const mutation = (await s.db.outbox.get("op"))!;
  await s.refreshManifest([manifest[0]]);
  expect((await s.db.outbox.get("op"))?.state).toBe("error");
  expect(
    await s.db.records.where("collection").equals("children").count(),
  ).toBe(0);
  await s.refreshManifest(manifest);
  expect(await s.get("children", mutation.bundle!.members[1].id)).toEqual(
    mutation.bundle!.members[1].document,
  );
  await expect(s.discardMutation("op")).rejects.toThrow("complete bundle");
});
it("does not resolve an operation that may be in flight", async () => {
  const s = await setup();
  await s.enqueueBundle("parents", input(), [definition], "op");
  await expect(s.resolveBundle("op", "server", [], [])).rejects.toThrow(
    "definitive rejection",
  );
  expect(await s.db.outbox.count()).toBe(1);
});
it("acknowledges parent and children together and clears the single queue entry", async () => {
  const s = await setup();
  await s.enqueueBundle("parents", input(), [definition], "op");
  const mutation = (await s.db.outbox.get("op"))!;
  await s.acknowledgeBundle(mutation, {
    data: { ...mutation.bundle!.members[0].document, _version: 1 },
    related: [
      {
        relationId: "rel",
        records: [{ ...mutation.bundle!.members[1].document, _version: 1 }],
      },
    ],
  });
  expect(await s.db.outbox.count()).toBe(0);
  expect(
    (await s.get("children", mutation.bundle!.members[1].id))?._version,
  ).toBe(1);
});
it("rebases a rejected bundle atomically under a fresh operation ID", async () => {
  const s = await setup();
  const parent = { id: "parent", created_at: "", updated_at: "", _version: 1 };
  const child = { id: "child", created_at: "", updated_at: "", _version: 1 };
  await s.applyPull("parents", {
    documents: [parent],
    cursor: "2",
    hasMore: false,
  });
  await s.applyPull("children", {
    documents: [child],
    cursor: "2",
    hasMore: false,
  });
  await s.enqueueBundle(
    "parents",
    {
      record: { id: parent.id, version: 1, data: {} },
      relations: [
        {
          relationId: "rel",
          previousIds: [child.id],
          rows: [{ id: child.id, version: 1, data: {} }],
        },
      ],
    },
    [definition],
    "op",
  );
  const mutation = (await s.db.outbox.get("op"))!;
  await s.rejectMutation(mutation, "conflict", "changed");
  const masters = [
    {
      collection: "parents",
      id: parent.id,
      document: { ...parent, _version: 3 },
    },
    {
      collection: "children",
      id: child.id,
      document: { ...child, _version: 4 },
    },
  ];
  const groups = [
    {
      definition,
      direction: "outgoing" as const,
      targetObject: "children",
      targetLabel: "Children",
      label: "Children",
      records: [{ id: child.id, label: "Child" }],
      total: 1,
      canEdit: true,
    },
  ];
  await s.resolveBundle("op", "local", masters, groups);
  const retry = (await s.db.outbox.toArray())[0];
  expect(retry.mutationId).not.toBe("op");
  expect(retry.bundle?.input.record.version).toBe(3);
  expect(retry.bundle?.input.relations[0].rows[0].version).toBe(4);
  await s.acknowledgeBundle(mutation, {
    data: { ...parent, _version: 99 },
    related: [],
  });
  expect(await s.db.outbox.count()).toBe(1);
  expect((await s.get("parents", parent.id))?._version).toBe(3);
});
it("preserves all bundle snapshots through authorization blocking", async () => {
  const s = await setup();
  await s.enqueueBundle("parents", input(), [definition], "op");
  const mutation = (await s.db.outbox.get("op"))!;
  await s.blockAuthorization("expired");
  expect(await s.db.records.count()).toBe(0);
  expect(await s.db.linkSnapshots.count()).toBe(0);
  await s.resumeAuthorization();
  await s.refreshManifest(manifest);
  for (const member of mutation.bundle!.members)
    expect(await s.get(member.collection, member.id)).toEqual(member.document);
  expect(await s.db.linkSnapshots.count()).toBe(1);
});
it("keeps revoked bundle replicas hidden when a late success arrives", async () => {
  const s = await setup();
  await s.enqueueBundle("parents", input(), [definition], "op");
  const mutation = (await s.db.outbox.get("op"))!;
  await s.refreshManifest([manifest[0]]);
  await s.acknowledgeBundle(mutation, {
    data: mutation.bundle!.members[0].document,
    related: [
      { relationId: "rel", records: [mutation.bundle!.members[1].document] },
    ],
  });
  expect(
    await s.db.records.where("collection").equals("children").count(),
  ).toBe(0);
  expect((await s.db.outbox.get("op"))?.state).toBe("error");
});
it("queues link-only rows without a version and preserves writable update patches", async () => {
  const s = await setup();
  const child = {
    id: "child",
    created_at: "",
    updated_at: "",
    _version: 2,
    name: "Old",
    locked: "Server",
    attachment: [{ key: "a" }],
    nested: ["x"],
  };
  await s.refreshManifest([
    manifest[0],
    {
      ...manifest[1],
      object: {
        config: {
          fields: {
            name: { type: "Textbox", label: "Name" },
            locked: { type: "Textbox", label: "Locked", readOnly: true },
            attachment: { type: "R2Attachment", label: "File" },
            nested: {
              type: "Dropdown",
              label: "Nested",
              config: { relation: "other", multiple: true },
            },
          },
        },
      },
    } as never,
  ]);
  await s.applyPull("children", {
    documents: [child],
    cursor: "3",
    hasMore: false,
  });
  await s.enqueueBundle(
    "parents",
    {
      record: { data: {} },
      relations: [{ relationId: "rel", rows: [{ id: "child" }] }],
    },
    [definition],
    "link",
  );
  expect(
    (await s.db.outbox.get("link"))?.bundle?.input.relations[0].rows[0],
  ).toEqual({ id: "child" });
  await s.db.outbox.clear();
  await s.enqueueBundle(
    "parents",
    {
      record: { data: {} },
      relations: [
        {
          relationId: "rel",
          rows: [
            {
              id: "child",
              data: { name: "New", locked: "Bad", attachment: [], nested: [] },
            },
          ],
        },
      ],
    },
    [definition],
    "edit",
  );
  expect(
    (await s.db.outbox.get("edit"))?.bundle?.input.relations[0].rows[0],
  ).toEqual({ id: "child", version: 2, data: { name: "New" } });
});
it("validates required virtual parent selections without persisting or transmitting them", async () => {
  const s = await setup();
  await s.refreshManifest([
    {
      ...manifest[0],
      object: {
        config: {
          fields: {
            children: {
              type: "Dropdown",
              label: "Children",
              required: true,
              config: { collectionRelation: "rel", multiple: true },
            },
          },
        },
      },
    } as never,
    manifest[1],
  ]);
  const parent = await s.enqueueBundle("parents", input(), [definition], "op");
  expect(parent).not.toHaveProperty("children");
  expect((await s.db.outbox.get("op"))?.bundle?.input.record.data).toEqual({});
  await expect(
    s.enqueueBundle(
      "parents",
      { record: { data: {} }, relations: [{ relationId: "rel", rows: [] }] },
      [definition],
      "empty",
    ),
  ).rejects.toThrow("obligatorio");
});
it("rejects multiple incoming parents and malformed acknowledgements atomically", async () => {
  const s = await setup();
  await expect(
    s.enqueueBundle(
      "children",
      {
        record: { data: {} },
        relations: [{ relationId: "rel", rows: [{ data: {} }, { data: {} }] }],
      },
      [definition],
      "incoming",
    ),
  ).rejects.toThrow("one record");
  await s.enqueueBundle("parents", input(), [definition], "op");
  const mutation = (await s.db.outbox.get("op"))!;
  await expect(
    s.acknowledgeBundle(mutation, {
      data: mutation.bundle!.members[0].document,
      related: [],
    }),
  ).rejects.toThrow("Incomplete");
  await expect(
    s.acknowledgeBundle(mutation, {
      data: { ...mutation.bundle!.members[0].document, id: "wrong" },
      related: [
        { relationId: "rel", records: [mutation.bundle!.members[1].document] },
      ],
    }),
  ).rejects.toThrow("Incomplete");
  expect(await s.db.outbox.get("op")).toEqual(mutation);
});
