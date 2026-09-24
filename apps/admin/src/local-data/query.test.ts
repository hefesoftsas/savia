import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, expect, test, vi } from "vitest";
import type { StudioObject, StudioRecord } from "@savia/studio-shared/metadata";
import { createRecordSortKeys, queryRecords, querySummary } from "./query";
const object = {
  name: "deals",
  config: {
    fields: {
      name: { type: "Textbox" },
      stage: { type: "Dropdown" },
      amount: { type: "Currency" },
      active: { type: "Toggle" },
      date: { type: "DateControl" },
    },
  },
} as unknown as StudioObject;
const dbs: Dexie[] = [];
async function setup(documents: Partial<StudioRecord>[]) {
  const db = new Dexie(`queries-${Math.random()}`);
  db.version(1).stores({
    records: "[collection+id],collection,*sortKeys",
    syncState: "collection",
    outbox: "mutationId,collection",
  });
  dbs.push(db);
  const records = db.table<
    {
      collection: string;
      id: string;
      document: StudioRecord;
      sortKeys: ReturnType<typeof createRecordSortKeys>;
    },
    [string, string]
  >("records");
  await records.bulkPut(
    documents.map((data, i) => {
      const document = {
        id: String(i).padStart(5, "0"),
        created_at: "2026-01-01",
        updated_at: "2026-01-01",
        ...data,
      } as StudioRecord;
      return {
        collection: "deals",
        id: document.id,
        document,
        sortKeys: createRecordSortKeys(
          "deals",
          document,
          Object.keys(object.config.fields),
        ),
      };
    }),
  );
  const syncState = db.table<
    { collection: string; dataRevision?: string },
    string
  >("syncState");
  await syncState.put({ collection: "deals", dataRevision: "initial" });
  const outbox = db.table<{ collection: string; mutationId: string }, string>(
    "outbox",
  );
  return { records, syncState, outbox };
}
afterEach(async () => {
  await Promise.all(dbs.splice(0).map((db) => db.delete()));
});
test("orders 10k rows with stable id ties and paginates indexed arbitrary fields", async () => {
  const db = await setup(
    Array.from({ length: 10000 }, (_, i) => ({
      amount: i % 100,
      name: `Deal ${i}`,
    })),
  );
  const result = await queryRecords(
    db,
    "deals",
    object,
    new URLSearchParams({
      sort: "amount",
      order: "DESC",
      page: "2",
      perPage: "3",
    }),
  );
  expect(result.total).toBe(10000);
  expect(result.data.map((r) => r.id)).toEqual(["00399", "00499", "00599"]);
}, 120000);
test("matches SQL null, boolean, literal text, date and empty-stage filtering", async () => {
  const db = await setup([
    { name: "100%_real", active: true, date: "2026-02-01", stage: null },
    { name: "100XXreal", active: false, date: "2025-01-01", stage: "Won" },
  ]);
  const result = await queryRecords(
    db,
    "deals",
    object,
    new URLSearchParams({
      q: "%_",
      searchField: "name",
      emptyStage: "true",
      filters: JSON.stringify({
        conditions: [
          { field: "active", op: "eq", value: true },
          { field: "date", op: "gt", value: "2026-01-01" },
        ],
      }),
    }),
  );
  expect(result.data.map((r) => r.id)).toEqual(["00000"]);
  expect(
    (
      await queryRecords(
        db,
        "deals",
        object,
        new URLSearchParams({
          filters: JSON.stringify({
            conditions: [{ field: "stage", op: "eq", value: null }],
          }),
        }),
      )
    ).total,
  ).toBe(1);
});
test("summary shares filters, sums numeric amounts and excludes trash", async () => {
  const db = await setup([
    { stage: "Won", amount: 10 },
    { stage: "Won", amount: "20.5" },
    { stage: null, amount: 3 },
    { stage: "Won", amount: 100, deleted_at: "2026-01-02" },
  ]);
  expect(
    await querySummary(db, "deals", object, new URLSearchParams()),
  ).toEqual({
    data: [
      { value: "Won", count: 2, amount: 30.5 },
      { value: null, count: 1, amount: 3 },
    ],
  });
});
test("rejects unsupported or malformed queries instead of returning misleading data", async () => {
  const db = await setup([]);
  await expect(
    queryRecords(db, "deals", object, new URLSearchParams({ filters: "{}" })),
  ).rejects.toThrow();
  await expect(
    queryRecords(db, "deals", object, new URLSearchParams({ sort: "unknown" })),
  ).rejects.toThrow();
  await expect(
    queryRecords(
      db,
      "deals",
      object,
      new URLSearchParams({ unsupported: "yes" }),
    ),
  ).rejects.toThrow();
});

test("sorts missing values, booleans and prefix strings with id tie breaks in both directions", async () => {
  const db = await setup([
    { name: "a", active: true },
    { name: "aa", active: false },
    { name: "a", active: true },
    { active: null },
  ]);
  expect(
    (
      await queryRecords(
        db,
        "deals",
        object,
        new URLSearchParams({ sort: "name", order: "DESC" }),
      )
    ).data.map((r) => r.id),
  ).toEqual(["00001", "00000", "00002", "00003"]);
  expect(
    (
      await queryRecords(
        db,
        "deals",
        object,
        new URLSearchParams({ sort: "active", order: "ASC" }),
      )
    ).data.map((r) => r.id),
  ).toEqual(["00003", "00001", "00000", "00002"]);
  const result = await queryRecords(
    db,
    "deals",
    object,
    new URLSearchParams({
      sort: "active",
      order: "DESC",
      filters: JSON.stringify({
        conditions: [{ field: "active", op: "eq", value: true }],
      }),
      perPage: "10000",
    }),
  );
  expect(result.total).toBe(2);
  expect(result.perPage).toBe(200);
  expect(result.data.map((r) => r.id)).toEqual(["00000", "00002"]);
});

test("record detail finds scalar and array incoming links, outgoing links and excludes deleted relations", async () => {
  const { queryRecordDetail } = await import("./query");
  const db = await setup([
    { id: "parent", name: "Parent" },
    { id: "other", name: "Other" },
  ]);
  const related = {
    name: "children",
    label: "Children",
    config: {
      fields: {
        parent: {
          label: "Parent",
          type: "Relation",
          config: { relation: "deals", multiple: true },
        },
      },
    },
  } as unknown as StudioObject;
  await db.records.bulkPut(
    [
      { id: "c1", parent: ["parent", "other"] },
      { id: "c2", parent: "parent" },
      { id: "c3", parent: "parent", deleted_at: "deleted" },
    ].map((value) => {
      const document = { ...value, created_at: "2026", updated_at: "2026" };
      return {
        collection: "children",
        id: value.id,
        document,
        sortKeys: createRecordSortKeys("children", document, ["parent"]),
      };
    }),
  );
  const definitions = [object, related].map((object) => ({
    name: object.name,
    object,
    capability: "read-write" as const,
    schemaVersion: 1,
  }));
  const result = await queryRecordDetail(
    db,
    "deals",
    "parent",
    new URLSearchParams(),
    definitions,
    new Set(["deals", "children"]),
  );
  expect(result.relationsComplete).toBe(true);
  expect(result.data.perPage).toBe(20);
  expect(result.data.relations[0]).toMatchObject({
    direction: "incoming",
    total: 2,
    field: "parent",
  });
  expect(result.data.relations[0].records.map((r) => r.id)).toEqual([
    "c1",
    "c2",
  ]);
  const outgoing = await queryRecordDetail(
    db,
    "children",
    "c1",
    new URLSearchParams(),
    definitions,
    new Set(["deals", "children"]),
  );
  expect(outgoing.data.relations[0]).toMatchObject({
    direction: "outgoing",
    total: 2,
  });
  expect(outgoing.data.relations[0].records.map((r) => r.id)).toEqual([
    "other",
    "parent",
  ]);
  const incomplete = await queryRecordDetail(
    db,
    "deals",
    "parent",
    new URLSearchParams(),
    definitions,
    new Set(["deals"]),
  );
  expect(incomplete.relationsComplete).toBe(false);
  expect(incomplete.data.relations).toEqual([]);
});

test.each<Record<string, string>>([
  { q: "" },
  { filters: JSON.stringify({ conditions: [] }) },
  {
    q: "",
    filters: JSON.stringify({ logic: "or", conditions: [] }),
    stage: "",
    emptyStage: "false",
  },
])(
  "reads only the requested page for inactive query constraints: %j",
  async (constraints) => {
    const db = await setup(
      Array.from({ length: 100 }, (_, amount) => ({ amount })),
    );
    let documentsRead = 0;
    db.records.hook("reading", (row) => {
      documentsRead++;
      return row;
    });
    const result = await queryRecords(
      db,
      "deals",
      object,
      new URLSearchParams({
        ...constraints,
        sort: "amount",
        order: "ASC",
        page: "2",
        perPage: "3",
      }),
    );
    expect(result.total).toBe(100);
    expect(result.data.map((record) => record.amount)).toEqual([3, 4, 5]);
    expect(documentsRead).toBe(3);
  },
);

test("compound filters count from indexes and load only the selected page", async () => {
  const db = await setup(
    Array.from({ length: 100 }, (_, amount) => ({
      amount,
      stage: amount % 2 ? "Won" : "Open",
    })),
  );
  let reads = 0;
  db.records.hook("reading", (row) => {
    reads++;
    return row;
  });
  const result = await queryRecords(
    db,
    "deals",
    object,
    new URLSearchParams({
      sort: "amount",
      order: "DESC",
      perPage: "3",
      page: "2",
      filters: JSON.stringify({
        conditions: [
          { field: "amount", op: "gte", value: 50 },
          { field: "stage", op: "eq", value: "Won" },
        ],
      }),
    }),
  );
  expect(result.total).toBe(25);
  expect(result.data.map((r) => r.amount)).toEqual([93, 91, 89]);
  expect(reads).toBe(3);
});

test("text filters load page documents only and reuse matches across pages", async () => {
  const db = await setup(
    Array.from({ length: 100 }, (_, amount) => ({
      amount,
      name: `Deal ${amount}`,
    })),
  );
  let reads = 0;
  db.records.hook("reading", (row) => {
    reads++;
    return row;
  });
  const params = new URLSearchParams({
    q: "Deal",
    searchField: "name",
    sort: "amount",
    order: "ASC",
    perPage: "3",
  });
  const first = await queryRecords(db, "deals", object, params);
  expect(first.total).toBe(100);
  expect(reads).toBe(3);
  params.set("page", "2");
  const second = await queryRecords(db, "deals", object, params);
  expect(second.data.map((r) => r.amount)).toEqual([3, 4, 5]);
  expect(reads).toBe(6);
});

test("reuses a filtered index result across page sizes and invalidates same-count changes from another connection", async () => {
  const db = await setup(
    Array.from({ length: 20 }, (_, amount) => ({
      amount,
      stage: amount % 2 ? "Won" : "Open",
    })),
  );
  const params = new URLSearchParams({
    sort: "amount",
    order: "ASC",
    perPage: "3",
    filters: JSON.stringify({
      conditions: [{ field: "stage", op: "eq", value: "Won" }],
    }),
  });
  const first = await queryRecords(db, "deals", object, params);
  expect(first.total).toBe(10);
  const where = vi.spyOn(db.records, "where");
  params.set("page", "2");
  params.set("perPage", "2");
  expect(
    (await queryRecords(db, "deals", object, params)).data.map((r) => r.amount),
  ).toEqual([5, 7]);
  expect(where).toHaveBeenCalledTimes(1); // sort range constructed, but no predicate or ordering scan
  where.mockRestore();
  const other = new Dexie(db.records.db.name);
  other.version(1).stores({
    records: "[collection+id],collection,*sortKeys",
    syncState: "collection",
    outbox: "mutationId,collection",
  });
  dbs.push(other);
  const row = (await db.records.get(["deals", "00001"]))!;
  row.document.stage = "Open";
  row.sortKeys = createRecordSortKeys(
    "deals",
    row.document,
    Object.keys(object.config.fields),
  );
  await other.open();
  // A native transaction deliberately emits no Dexie/BroadcastChannel event:
  // this reproduces a committed cross-tab write whose notification is delayed.
  await new Promise<void>((resolve, reject) => {
    const tx = other
      .backendDB()
      .transaction(["records", "syncState"], "readwrite");
    tx.objectStore("records").put(row);
    tx.objectStore("syncState").put({
      collection: "deals",
      dataRevision: "updated",
    });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  const updated = await queryRecords(db, "deals", object, params);
  expect(updated.total).toBe(9);
  expect(updated.data.map((r) => r.amount)).toEqual([7, 9]);
  other.close();
});

test.each([
  ["eq", null, [0]],
  ["ne", null, [1, 2, 3, 4, 5]],
  ["gt", 5, [3, 4, 5]],
  ["gte", 5, [2, 3, 4, 5]],
  ["lt", "b", [1, 2, 3, 4]],
  ["lte", "a", [1, 2, 3, 4]],
  ["empty", undefined, [0]],
  ["in", [5, "a"], [2, 4]],
])(
  "indexed %s preserves null and mixed scalar ordering",
  async (op, value, expected) => {
    const db = await setup(
      [null, 0, 5, 10, "a", "b"].map((amount) => ({ amount })),
    );
    const result = await queryRecords(
      db,
      "deals",
      object,
      new URLSearchParams({
        sort: "id",
        order: "ASC",
        filters: JSON.stringify({
          conditions: [{ field: "amount", op, value }],
        }),
      }),
    );
    expect(result.data.map((r) => Number(r.id))).toEqual(expected);
  },
);

test("OR filters deduplicate matches, preserve trash scope and intersect with search", async () => {
  const db = await setup([
    { name: "ALPHA", stage: "Won", amount: 10 },
    { name: "alpha", stage: "Open", amount: 20 },
    { name: "other", stage: "Won", amount: 10 },
    { name: "alpha", stage: "Won", amount: 10, deleted_at: "deleted" },
  ]);
  const constraints = {
    logic: "or",
    conditions: [
      { field: "stage", op: "eq", value: "Won" },
      { field: "amount", op: "gte", value: 10 },
    ],
  };
  const params = new URLSearchParams({
    q: "alpha",
    searchField: "name",
    filters: JSON.stringify(constraints),
  });
  expect((await queryRecords(db, "deals", object, params)).total).toBe(2);
  params.set("trash", "true");
  expect(
    (await queryRecords(db, "deals", object, params)).data.map((r) => r.id),
  ).toEqual(["00003"]);
});

test("filtered summaries aggregate index values without deserializing records", async () => {
  const db = await setup([
    { stage: "Won", amount: 10 },
    { stage: "Won", amount: "20.5" },
    { stage: "Open", amount: 4 },
    { stage: "Won", amount: 50, deleted_at: "deleted" },
  ]);
  let reads = 0;
  db.records.hook("reading", (row) => {
    reads++;
    return row;
  });
  const result = await querySummary(
    db,
    "deals",
    object,
    new URLSearchParams({
      group: "stage",
      amountField: "amount",
      filters: JSON.stringify({
        conditions: [{ field: "stage", op: "eq", value: "Won" }],
      }),
    }),
  );
  expect(result.data).toEqual([{ value: "Won", count: 2, amount: 30.5 }]);
  expect(reads).toBe(0);
});

test("unrestricted text scans bounded batches once and reuses exact matches for later pages", async () => {
  const db = await setup(
    Array.from({ length: 600 }, (_, amount) => ({
      name: `Deal ${amount}`,
      amount,
    })),
  );
  let reads = 0;
  db.records.hook("reading", (row) => {
    reads++;
    return row;
  });
  const params = new URLSearchParams({
    q: "deal",
    sort: "amount",
    order: "ASC",
    perPage: "3",
  });
  const first = await queryRecords(db, "deals", object, params);
  expect(first.total).toBe(600);
  expect(reads).toBe(603);
  params.set("page", "2");
  expect(
    (await queryRecords(db, "deals", object, params)).data.map((r) => r.amount),
  ).toEqual([3, 4, 5]);
  expect(reads).toBe(606);
});

test.each(["cursor", "outbox"])(
  "invalidates legacy %s writes even before notifications arrive",
  async (kind) => {
    const db = await setup([
      { stage: "Won", amount: 1 },
      { stage: "Open", amount: 2 },
    ]);
    const params = new URLSearchParams({
      filters: JSON.stringify({
        conditions: [{ field: "stage", op: "eq", value: "Won" }],
      }),
    });
    expect((await queryRecords(db, "deals", object, params)).total).toBe(1);
    const row = (await db.records.get(["deals", "00001"]))!;
    row.document.stage = "Won";
    row.sortKeys = createRecordSortKeys(
      "deals",
      row.document,
      Object.keys(object.config.fields),
    );
    await new Promise<void>((resolve, reject) => {
      const tx = db.records.db
        .backendDB()
        .transaction(["records", "syncState", "outbox"], "readwrite");
      tx.objectStore("records").put(row);
      if (kind === "cursor")
        tx.objectStore("syncState").put({
          collection: "deals",
          dataRevision: "initial",
          cursor: "advanced",
        });
      else
        tx.objectStore("outbox").put({
          collection: "deals",
          mutationId: "legacy-edit",
        });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    expect((await queryRecords(db, "deals", object, params)).total).toBe(2);
  },
);

test("a query finishing after database close cannot repopulate its disposed cache", async () => {
  const { queryCache } = await import("./query-cache");
  const db = await setup([]);
  const cache = queryCache(db.records.db);
  cache.put("existing", "deals", ["one"]);
  db.records.db.close();
  cache.put("late", "deals", ["two"]);
  expect(cache.get("late")).toBeUndefined();
});
