import { migrationStatements } from "./migration-statements";
import { afterAll, beforeAll, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";
import { readFileSync } from "node:fs";
import { getRecordCounts, getRevisionedRead } from "../src/record-read-state";

let platform: Awaited<ReturnType<typeof getPlatformProxy<{ DB: D1Database }>>>;
let db: D1Database;

beforeAll(async () => {
  platform = await getPlatformProxy({
    configPath: "wrangler.jsonc",
    persist: false,
  });
  db = platform.env.DB;
  await db
    .prepare(
      `
    CREATE TABLE studio_records (
      id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      object_name TEXT NOT NULL,
      data TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      PRIMARY KEY (tenant_id, id)
    )
  `,
    )
    .run();
  await db.batch([
    db
      .prepare("INSERT INTO studio_records VALUES(?,?,?,?,?,?,?)")
      .bind("a1", "tenant-a", "items", "{}", "2026-01-01", "2026-01-01", null),
    db
      .prepare("INSERT INTO studio_records VALUES(?,?,?,?,?,?,?)")
      .bind(
        "a2",
        "tenant-a",
        "items",
        "{}",
        "2026-01-02",
        "2026-01-02",
        "2026-02-01",
      ),
    db
      .prepare("INSERT INTO studio_records VALUES(?,?,?,?,?,?,?)")
      .bind("b1", "tenant-b", "items", "{}", "2026-01-01", "2026-01-01", null),
  ]);
  const migration = readFileSync(
    "../db/migrations/0079_record_read_state.sql",
    "utf8",
  );
  for (const sql of migrationStatements(migration)) await db.prepare(sql).run();
});

afterAll(async () => {
  await platform?.dispose();
});

const counts = (tenant: string, objectName = "items") =>
  getRecordCounts(db, tenant, objectName);

it("backfills and maintains exact active/trash counts through transitions and moves", async () => {
  expect(await counts("tenant-a")).toMatchObject({
    activeCount: 1,
    trashCount: 1,
  });
  expect(await counts("tenant-b")).toMatchObject({
    activeCount: 1,
    trashCount: 0,
  });

  await db
    .prepare(
      `INSERT INTO studio_records VALUES
       ('a3','tenant-a','items','{}','2026-01-03','2026-01-03',NULL)`,
    )
    .run();
  expect(await counts("tenant-a")).toMatchObject({
    activeCount: 2,
    trashCount: 1,
  });

  await db
    .prepare(
      `UPDATE studio_records SET deleted_at='2026-03-01'
       WHERE tenant_id='tenant-a' AND id='a3'`,
    )
    .run();
  expect(await counts("tenant-a")).toMatchObject({
    activeCount: 1,
    trashCount: 2,
  });
  await db
    .prepare(
      `UPDATE studio_records SET deleted_at=NULL
       WHERE tenant_id='tenant-a' AND id='a2'`,
    )
    .run();
  expect(await counts("tenant-a")).toMatchObject({
    activeCount: 2,
    trashCount: 1,
  });

  await db
    .prepare(
      `UPDATE studio_records SET tenant_id='tenant-b', object_name='archive'
       WHERE tenant_id='tenant-a' AND id='a3'`,
    )
    .run();
  expect(await counts("tenant-a")).toMatchObject({
    activeCount: 2,
    trashCount: 0,
  });
  expect(await counts("tenant-b", "archive")).toMatchObject({
    activeCount: 0,
    trashCount: 1,
  });

  await db
    .prepare(
      `DELETE FROM studio_records WHERE tenant_id='tenant-a' AND id='a1'`,
    )
    .run();
  expect(await counts("tenant-a")).toMatchObject({
    activeCount: 1,
    trashCount: 0,
  });
  expect(await counts("tenant-b")).toMatchObject({
    activeCount: 1,
    trashCount: 0,
  });
});

it("isolates tenant/object counts and invalidates cached reads by record revision", async () => {
  let computes = 0;
  const read = () =>
    getRevisionedRead(db, "tenant-a", "items", "summary:v1", async () => {
      computes++;
      return (await counts("tenant-a")).activeCount;
    });

  const first = await read();
  expect(await read()).toBe(first);
  expect(computes).toBe(1);
  expect(await counts("tenant-b", "items")).toMatchObject({ activeCount: 1 });
  expect(await counts("tenant-b", "archive")).toMatchObject({ trashCount: 1 });

  await db
    .prepare(
      `INSERT INTO studio_records VALUES
       ('a4','tenant-a','items','{}','2026-04-01','2026-04-01',NULL)`,
    )
    .run();
  expect(await read()).toBe(first + 1);
  expect(computes).toBe(2);
});

it("does not cache a computation under a revision changed while it ran", async () => {
  let computes = 0;
  const run = () =>
    getRevisionedRead(db, "tenant-a", "items", "racing-summary", async () => {
      computes++;
      if (computes === 1) {
        await db
          .prepare(
            `INSERT INTO studio_records VALUES
             ('a5','tenant-a','items','{}','2026-05-01','2026-05-01',NULL)`,
          )
          .run();
      }
      return (await counts("tenant-a")).activeCount;
    });

  const value = await run();
  expect(await run()).toBe(value);
  expect(computes).toBe(2);
});
