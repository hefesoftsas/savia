import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, expect, test } from "vitest";
import type { CrmObject, CrmRecord } from "@savia/crm-shared/metadata";
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
} as unknown as CrmObject;
const dbs: Dexie[] = [];
async function setup(documents: Partial<CrmRecord>[]) {
  const db = new Dexie(`queries-${Math.random()}`);
  db.version(1).stores({ records: "[collection+id],collection,*sortKeys" });
  dbs.push(db);
  const records = db.table<
    {
      collection: string;
      id: string;
      document: CrmRecord;
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
      } as CrmRecord;
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
  return { records };
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
  } as unknown as CrmObject;
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
