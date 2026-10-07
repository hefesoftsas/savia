import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { SqliteDatabase } from "../src/sqlite.js";

it("keeps the PostgreSQL public quote-link inventory aligned with D1 migrations", async () => {
  const root = resolve(import.meta.dirname, "../../..");
  const manifest = JSON.parse(
    readFileSync(resolve(root, "packages/db/postgres/manifest.json"), "utf8"),
  );
  const database = new SqliteDatabase(":memory:");
  try {
    await database.migrate(resolve(root, "packages/db/migrations"));
    const table = manifest.tables.find(
      (entry: { name: string }) => entry.name === "public_quote_links",
    );
    expect(table).toBeDefined();
    const columns = await database
      .prepare("PRAGMA table_info(public_quote_links)")
      .all();
    const normalize = (column: Record<string, unknown>) => ({
      ...column,
      type: column.type === "BIGINT" ? "INTEGER" : column.type,
    });
    expect(columns.results.map(normalize)).toEqual(
      table.columns.map(normalize),
    );
    expect(table.foreignKeys).toEqual([]);
    expect(table.checkCount).toBe(1);
    for (const index of [
      "public_quote_links_tenant_quote",
      "public_quote_links_expiry",
    ]) {
      expect(manifest.objects).toContainEqual({
        type: "index",
        name: index,
        table: "public_quote_links",
      });
      const exists = await database
        .prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name=?")
        .bind(index)
        .first();
      expect(exists).toBeTruthy();
    }
  } finally {
    database.close();
  }
});
