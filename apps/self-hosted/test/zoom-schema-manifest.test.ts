import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { SqliteDatabase } from "../src/sqlite.js";

it("keeps the PostgreSQL inventory aligned with the migrated Zoom source tables", async () => {
  const root = resolve(import.meta.dirname, "../../..");
  const manifest = JSON.parse(
    readFileSync(resolve(root, "packages/db/postgres/manifest.json"), "utf8"),
  );
  const database = new SqliteDatabase(":memory:");
  try {
    await database.migrate(resolve(root, "packages/db/migrations"));
    for (const name of [
      "zoom_personal_meetings",
      "tenant_booking_calendar_grants",
      "tenant_bookings",
    ]) {
      const table = manifest.tables.find(
        (entry: { name: string }) => entry.name === name,
      );
      const columns = await database
        .prepare(`PRAGMA table_info(${name})`)
        .all();
      const normalize = (column: Record<string, unknown>) => ({
        ...column,
        type: column.type === "BIGINT" ? "INTEGER" : column.type,
      });
      expect(columns.results.map(normalize), name).toEqual(
        table.columns.map(normalize),
      );
      const sql = await database
        .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?")
        .bind(name)
        .first<string>("sql");
      expect(sql?.match(/\bCHECK\s*\(/gi)?.length ?? 0, name).toBe(
        table.checkCount,
      );
    }
  } finally {
    database.close();
  }
});
