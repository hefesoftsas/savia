// Table-by-table D1 dump for databases that `wrangler d1 export` refuses
// (it cannot export virtual tables such as FTS5). Dumps regular tables as
// INSERT statements; FTS5 virtual tables and their shadow tables are skipped
// and recorded — they are rebuilt from content tables by the migration
// triggers on restore. Views, indexes, and triggers come from
// packages/db/migrations on restore.
import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export const FTS_SHADOW_SUFFIXES = Object.freeze([
  "_data",
  "_idx",
  "_content",
  "_docsize",
  "_config",
  "_segments",
  "_segdir",
  "_stat",
]);

// Platform tables reject direct reads (SQLITE_AUTH) by design; skipping
// them is safe. Anything else unreadable fails the backup loudly — a
// silent skip could hide an entire production table.
export const PLATFORM_UNREADABLE_TABLES = Object.freeze(["_cf_KV"]);

export function isPlatformTable(name) {
  return PLATFORM_UNREADABLE_TABLES.includes(name);
}

export function shadowTablesFor(ftsName) {
  return FTS_SHADOW_SUFFIXES.map((suffix) => `${ftsName}${suffix}`);
}

export function isSkippedTable(name, ftsNames) {
  for (const fts of ftsNames) {
    if (name === fts || shadowTablesFor(fts).includes(name)) return true;
  }
  return false;
}

export function quoteIdent(name) {
  if (typeof name !== "string" || name === "")
    throw new Error("Invalid identifier");
  return `"${name.replaceAll('"', '""')}"`;
}

export function formatValue(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Non-finite number");
    return String(value);
  }
  if (typeof value === "bigint") return `${value}`;
  if (typeof value === "boolean") return value ? "1" : "0";
  if (Array.isArray(value)) {
    const bytes = value.map((b) => {
      if (!Number.isInteger(b) || b < 0 || b > 255)
        throw new Error("Invalid blob byte");
      return b.toString(16).padStart(2, "0");
    });
    return `X'${bytes.join("")}'`;
  }
  if (typeof value === "string") return `'${value.replaceAll("'", "''")}'`;
  throw new Error(`Unsupported value type: ${typeof value}`);
}

export function buildInsert(table, columns, row) {
  if (!Array.isArray(columns) || columns.length === 0)
    throw new Error("columns required");
  const names = columns.map(quoteIdent).join(",");
  const values = columns.map((c) => formatValue(row[c])).join(",");
  // Restore runs migrations first, so backed-up rows can overlap seeds and
  // migration-ledger entries. UPSERT updates those rows in place: SQLite's
  // REPLACE deletes the conflicting row first, which can cascade-delete
  // restored child rows before deferred foreign keys are checked.
  const updates = columns
    .map((column) => `${quoteIdent(column)}=excluded.${quoteIdent(column)}`)
    .join(",");
  return `INSERT INTO ${quoteIdent(table)} (${names}) VALUES (${values}) ON CONFLICT DO UPDATE SET ${updates};`;
}

export function buildSelectPage(
  table,
  columns,
  limit,
  offset,
  orderByRowid = true,
) {
  if (!Number.isInteger(limit) || limit <= 0) throw new Error("limit required");
  if (!Number.isInteger(offset) || offset < 0)
    throw new Error("offset required");
  const names = columns.map(quoteIdent).join(",");
  const order = orderByRowid ? " ORDER BY rowid" : "";
  return `SELECT ${names} FROM ${quoteIdent(table)}${order} LIMIT ${limit} OFFSET ${offset}`;
}

// wrangler d1 export refuses virtual tables; detect that specific failure
// so backup.mjs can fall back to the table dump instead of aborting.
export function isVirtualTableExportError(error) {
  return /virtual tables|like FTS5/i.test(
    String(error?.stderr ?? error?.stdout ?? error?.message ?? ""),
  );
}

export async function appendInserts(outputFile, table, columns, rows) {
  let sql = "";
  for (const row of rows) sql += `${buildInsert(table, columns, row)}\n`;
  await writeFile(outputFile, sql, { flag: "a" });
}

export async function writeDumpHeader(outputFile) {
  await mkdir(dirname(outputFile), { recursive: true });
  await writeFile(
    outputFile,
    "-- D1 table dump\nPRAGMA defer_foreign_keys = ON;\n",
    {
      flag: "w",
    },
  );
}

function d1Query(accountId, uuid, token, sql) {
  return fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${uuid}/query`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ sql }),
    },
  ).then(async (response) => {
    const payload = await response.json();
    if (response.ok === false || payload.success === false) {
      throw new Error(
        `D1 query failed (${response.status}): ${JSON.stringify(payload.errors ?? payload).slice(0, 200)}`,
      );
    }
    return payload.result[0];
  });
}

// Full data dump of one D1 database via the HTTP API. Returns a summary
// for the backup manifest. Throws on API errors (caller decides retry).
export async function dumpDatabase({
  accountId,
  uuid,
  token,
  outputFile,
  stack,
  batchSize = 200,
  quiescent = false,
}) {
  if (!accountId || !uuid || !token || !outputFile)
    throw new Error("accountId, uuid, token and outputFile are required");
  if (stack === "production") {
    throw new Error("Production table-dump fallback is disabled");
  }
  if (stack !== "preview") {
    throw new Error(
      "stack must be preview; production table-dump fallback is disabled",
    );
  }
  if (!quiescent)
    throw new Error(
      "Refusing the inconsistent table-dump fallback without explicit write-quiescence confirmation",
    );
  const query = (sql) => d1Query(accountId, uuid, token, sql);
  const tables = query(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  ).then((r) => r.results.map((row) => row.name));
  const fts = query(
    "SELECT name FROM sqlite_master WHERE sql LIKE '%USING fts5%'",
  )
    .then((r) => r.results.map((row) => row.name))
    .catch(() => []);
  const [allTables, ftsNames] = await Promise.all([tables, fts]);
  const skipped = [];
  for (const ftsName of ftsNames)
    skipped.push(ftsName, ...shadowTablesFor(ftsName));
  const targets = allTables.filter((t) => !isSkippedTable(t, ftsNames));
  let totalRows = 0;
  const dumped = [];
  await writeDumpHeader(outputFile);
  for (const table of targets) {
    try {
      const columns = (
        await query(`PRAGMA table_info(${quoteIdent(table)})`)
      ).results.map((row) => row.name);
      if (columns.length === 0) continue;
      const createSql =
        (
          await query(
            `SELECT sql FROM sqlite_master WHERE name = ${formatValue(table)}`,
          )
        ).results[0]?.sql ?? "";
      const orderByRowid = !/WITHOUT ROWID/i.test(createSql);
      const count = (
        await query(`SELECT COUNT(*) AS c FROM ${quoteIdent(table)}`)
      ).results[0].c;
      await writeFile(outputFile, `-- table ${table} (${count} rows)\n`, {
        flag: "a",
      });
      let offset = 0;
      while (true) {
        const page = await query(
          buildSelectPage(table, columns, batchSize, offset, orderByRowid),
        );
        const rows = page.results ?? [];
        if (rows.length === 0) break;
        await appendInserts(outputFile, table, columns, rows);
        offset += rows.length;
        totalRows += rows.length;
        if (rows.length < batchSize) break;
      }
      dumped.push(table);
    } catch (error) {
      // Platform tables such as _cf_KV reject direct reads (SQLITE_AUTH);
      // record and continue. App-table failures abort: a backup missing a
      // production table must never report success.
      if (isPlatformTable(table)) {
        skipped.push(`${table} (platform table, unreadable by design)`);
        continue;
      }
      throw new Error(
        `Refusing to finish backup with unreadable table ${table}: ${error.message.slice(0, 120)}`,
      );
    }
  }
  return Object.freeze({
    method: "table-dump",
    tables: dumped.length,
    rows: totalRows,
    skipped,
  });
}
