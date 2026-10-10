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
  return `INSERT INTO ${quoteIdent(table)} (${names}) VALUES (${values});`;
}

export function buildSelectPage(table, columns, limit, offset, orderByRowid = true) {
  if (!Number.isInteger(limit) || limit <= 0)
    throw new Error("limit required");
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

export async function writeTableHeader(outputFile, table, rowCount) {
  await mkdir(dirname(outputFile), { recursive: true });
  await writeFile(
    outputFile,
    `-- table dump of ${table} (${rowCount} rows)\nBEGIN;\n`,
    { flag: "w" },
  );
}

export async function appendCommit(outputFile) {
  await writeFile(outputFile, "COMMIT;\n", { flag: "a" });
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
  batchSize = 200,
}) {
  if (!accountId || !uuid || !token || !outputFile)
    throw new Error("accountId, uuid, token and outputFile are required");
  const query = (sql) => d1Query(accountId, uuid, token, sql);
  const tables = query(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  ).then((r) => r.results.map((row) => row.name));
  const fts = query("SELECT name FROM sqlite_master WHERE sql LIKE '%USING fts5%'")
    .then((r) => r.results.map((row) => row.name))
    .catch(() => []);
  const [allTables, ftsNames] = await Promise.all([tables, fts]);
  const skipped = [];
  for (const ftsName of ftsNames) skipped.push(ftsName, ...shadowTablesFor(ftsName));
  const targets = allTables.filter((t) => !isSkippedTable(t, ftsNames));
  let first = true;
  let totalRows = 0;
  const dumped = [];
  for (const table of targets) {
    try {
      const columns = (
        await query(`PRAGMA table_info(${quoteIdent(table)})`)
      ).results.map((row) => row.name);
      if (columns.length === 0) continue;
      const createSql = (
        await query(
          `SELECT sql FROM sqlite_master WHERE name = ${formatValue(table)}`,
        )
      ).results[0]?.sql ?? "";
      const orderByRowid = !/WITHOUT ROWID/i.test(createSql);
      const count = (
        await query(`SELECT COUNT(*) AS c FROM ${quoteIdent(table)}`)
      ).results[0].c;
      if (first) {
        await mkdir(dirname(outputFile), { recursive: true });
        await writeFile(outputFile, `-- D1 table dump\n`, { flag: "w" });
        first = false;
      }
      await writeFile(
        outputFile,
        `-- table ${table} (${count} rows)\nBEGIN;\n`,
        { flag: "a" },
      );
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
      await appendCommit(outputFile);
      dumped.push(table);
    } catch (error) {
      // Platform tables such as _cf_KV reject direct reads (SQLITE_AUTH);
      // record and continue so one unreadable table never sinks a backup.
      skipped.push(`${table} (unreadable: ${error.message.slice(0, 80)})`);
      continue;
    }
  }
  return Object.freeze({
    method: "table-dump",
    tables: dumped.length,
    rows: totalRows,
    skipped,
  });
}
