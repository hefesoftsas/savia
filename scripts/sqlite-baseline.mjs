import { DatabaseSync } from "node:sqlite";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const quote = (name) => '"' + name.replaceAll('"', '""') + '"';
const literal = (value) => {
  if (value === null) return "NULL";
  if (typeof value === "number" || typeof value === "bigint")
    return String(value);
  if (value instanceof Uint8Array)
    return "X'" + Buffer.from(value).toString("hex") + "'";
  return "'" + value.replaceAll("'", "''") + "'";
};
const script = (statements) =>
  statements
    .map((s) => s.replace(/;\s*$/, "") + ";")
    .join("\n--> statement-breakpoint\n") + "\n";

/** Snapshot a fully migrated, empty application database, never a live data export. */
export function sqliteBaseline(database) {
  const tables = database.prepare("PRAGMA table_list").all();
  const excluded = new Set(
    tables
      .filter(
        (t) =>
          t.type === "shadow" ||
          t.name.startsWith("sqlite_") ||
          t.name.startsWith("_cf_") ||
          [
            "_savia_migrations",
            "_savia_sqlite_migrations",
            "d1_migrations",
            "__drizzle_migrations",
          ].includes(t.name),
      )
      .map((t) => t.name),
  );
  const objects = database
    .prepare(
      "SELECT type,name,tbl_name,sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 WHEN 'view' THEN 2 ELSE 3 END,name",
    )
    .all()
    .filter((row) => !excluded.has(row.name) && !excluded.has(row.tbl_name));
  const seeds = [];
  for (const table of objects.filter(
    (o) => o.type === "table" && !o.sql.startsWith("CREATE VIRTUAL"),
  )) {
    const columns = database
      .prepare(`PRAGMA table_xinfo(${quote(table.name)})`)
      .all()
      .filter((c) => c.hidden === 0)
      .map((c) => c.name);
    for (const row of database
      .prepare(
        `SELECT ${columns.map(quote).join(",")} FROM ${quote(table.name)}`,
      )
      .all())
      seeds.push(
        `INSERT INTO ${quote(table.name)} (${columns.map(quote).join(",")}) VALUES (${columns.map((c) => literal(row[c])).join(",")})`,
      );
  }
  return {
    schema: script(objects.map((o) => o.sql)),
    bootstrap: script(seeds),
    seedCount: seeds.length,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const [source, destination] = process.argv.slice(2);
  if (!source || !destination)
    throw Error(
      "Usage: node scripts/sqlite-baseline.mjs <empty-migrated.sqlite> <output-directory>",
    );
  const db = new DatabaseSync(source, { readOnly: true });
  try {
    const result = sqliteBaseline(db);
    mkdirSync(destination, { recursive: true });
    writeFileSync(resolve(destination, "0001_initial.sql"), result.schema);
    if (result.seedCount)
      writeFileSync(
        resolve(destination, "0002_bootstrap.sql"),
        result.bootstrap,
      );
    console.log(
      `Created initial schema and ${result.seedCount} bootstrap rows.`,
    );
  } finally {
    db.close();
  }
}
