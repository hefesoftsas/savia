// Table-by-table D1 dump for databases that `wrangler d1 export` refuses
// (it cannot export virtual tables such as FTS5). Dumps regular tables as
// INSERT statements; production schema dumps also carry CREATE TABLE SQL,
// external-content FTS5 definitions, and explicit schema objects. Legacy
// table dumps include schema for retired tables and the Wrangler ledger.
// Platform metadata and unsupported virtual tables fail closed or are
// skipped only when Cloudflare denies access by design.
import { writeFile, mkdir, rm } from "node:fs/promises";
import { dirname } from "node:path";
import {
  RecoveryConsistencyError,
  readD1Bookmark,
} from "./recovery-consistency.mjs";

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

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

function d1Query(accountId, uuid, token, sql, fetchImpl) {
  return fetchImpl(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${uuid}/query`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ sql }),
      signal: AbortSignal.timeout(30_000),
    },
  ).then(async (response) => {
    const payload = await response.json();
    if (
      response.ok !== true ||
      payload.success !== true ||
      payload.result?.[0]?.success !== true
    ) {
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
  fetchImpl = fetch,
}) {
  if (!accountId || !uuid || !token || !outputFile)
    throw new Error("accountId, uuid, token and outputFile are required");
  if (!["preview", "production"].includes(stack))
    throw new Error("stack must be preview or production");
  if (stack === "preview" && !quiescent)
    throw new Error(
      "Refusing the inconsistent table-dump fallback without explicit write-quiescence confirmation",
    );
  const options = { accountId, token, fetchImpl };
  const bookmark =
    stack === "production" ? await readD1Bookmark(uuid, options) : null;
  try {
    const summary = await dumpTables({
      outputFile,
      batchSize,
      schemaDump: stack === "production",
      query: (sql) => d1Query(accountId, uuid, token, sql, fetchImpl),
    });
    if (bookmark && bookmark !== (await readD1Bookmark(uuid, options)))
      throw new RecoveryConsistencyError(
        "D1 changed during production table dump; retry in a controlled maintenance window",
      );
    return summary;
  } catch (error) {
    await rm(outputFile, { force: true });
    throw error;
  }
}

export async function dumpTables({
  outputFile,
  batchSize,
  query,
  schemaDump = false,
}) {
  const tables = query(
    "SELECT name FROM sqlite_master WHERE type='table' AND substr(name,1,7) != 'sqlite_' ORDER BY name",
  ).then((r) => r.results.map((row) => row.name));
  const fts = query(
    "SELECT name FROM sqlite_master WHERE sql LIKE '%USING fts5%'",
  ).then((r) => r.results.map((row) => row.name));
  const [allTables, ftsNames] = await Promise.all([tables, fts]);
  const retiredTables = allTables.filter((name) =>
    name.startsWith("_savia_retired_"),
  );
  const skipped = [];
  for (const ftsName of ftsNames)
    skipped.push(ftsName, ...shadowTablesFor(ftsName));
  const targets = allTables.filter((table) => !isSkippedTable(table, ftsNames));
  const preservedTables = schemaDump
    ? targets.filter((table) => !isPlatformTable(table))
    : [
        ...retiredTables,
        ...(allTables.includes("d1_migrations") ? ["d1_migrations"] : []),
      ];
  const tableDdlByName = new Map();
  if (schemaDump) {
    const catalog = (
      await query(
        "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND substr(name,1,7) != 'sqlite_' AND name != '_cf_KV' ORDER BY name",
      )
    ).results;
    for (const row of catalog) tableDdlByName.set(row.name, row.sql);
  }
  const preservedSchema = [];
  for (const table of preservedTables) {
    const createSql = schemaDump
      ? tableDdlByName.get(table)
      : (
          await query(
            `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ${formatValue(table)}`,
          )
        ).results[0]?.sql;
    const virtualTable =
      typeof createSql === "string" &&
      /^\s*CREATE\s+VIRTUAL\s+TABLE\s+/i.test(createSql);
    if (
      typeof createSql !== "string" ||
      (!virtualTable && !/^\s*CREATE\s+TABLE\s+/i.test(createSql)) ||
      (virtualTable && !schemaDump) ||
      /\bIF\s+NOT\s+EXISTS\b/i.test(createSql)
    ) {
      throw new Error(
        `Refusing retired table ${table}: its schema cannot be safely recreated from a plain CREATE TABLE statement`,
      );
    }
    preservedSchema.push({ table, createSql });
  }
  const ftsSchema = [];
  if (schemaDump) {
    for (const table of targets) {
      const createSql = preservedSchema.find(
        (entry) => entry.table === table,
      )?.createSql;
      if (/^\s*CREATE\s+VIRTUAL\s+TABLE\s+/i.test(createSql ?? "")) {
        throw new Error(
          `Refusing schema dump: unsupported virtual table ${table}`,
        );
      }
    }
    for (const table of ftsNames) {
      const createSql = tableDdlByName.get(table);
      const content =
        typeof createSql === "string"
          ? /\bcontent\s*=\s*(['"])(.*?)\1/i.exec(createSql)?.[2]
          : null;
      if (
        typeof createSql !== "string" ||
        !/^\s*CREATE\s+VIRTUAL\s+TABLE\s+/i.test(createSql) ||
        !/\bUSING\s+fts5\s*\(/i.test(createSql) ||
        !content ||
        !targets.some(
          (target) => target.toLowerCase() === content.toLowerCase(),
        )
      ) {
        throw new Error(
          `Refusing schema dump: FTS table ${table} is not a supported external-content FTS5 table`,
        );
      }
      ftsSchema.push({ table, createSql });
    }
  }
  const preservedNames = new Set(preservedTables);
  const preservedObjects = [];
  if (schemaDump || preservedNames.size > 0) {
    const objects = (
      await query(
        "SELECT type, name, sql, tbl_name FROM sqlite_master WHERE type IN ('index', 'trigger', 'view') AND sql IS NOT NULL AND tbl_name != '_cf_KV' ORDER BY type, name",
      )
    ).results;
    const objectPriority = { index: 0, trigger: 1, view: 2 };
    for (const object of objects) {
      const isPlatformOwnedObject =
        (object.type === "index" || object.type === "trigger") &&
        isPlatformTable(object.tbl_name);
      const referencesPlatformTable =
        object.type === "view" &&
        PLATFORM_UNREADABLE_TABLES.some((table) =>
          new RegExp(
            `(^|[^A-Za-z0-9_])${escapeRegExp(table)}($|[^A-Za-z0-9_])`,
            "i",
          ).test(object.sql),
        );
      if (isPlatformOwnedObject || referencesPlatformTable) continue;
      const ownedByPreservedTable =
        (object.type === "index" || object.type === "trigger") &&
        preservedNames.has(object.tbl_name);
      const referencesPreservedTable =
        object.type === "view" &&
        [...preservedNames].some((table) =>
          new RegExp(
            `(^|[^A-Za-z0-9_])${escapeRegExp(table)}($|[^A-Za-z0-9_])`,
            "i",
          ).test(object.sql),
        );
      if (schemaDump || ownedByPreservedTable || referencesPreservedTable) {
        preservedObjects.push(object);
      }
    }
    preservedObjects.sort(
      (a, b) =>
        objectPriority[a.type] - objectPriority[b.type] ||
        a.name.localeCompare(b.name),
    );
  }
  let totalRows = 0;
  const dumped = [];
  await writeDumpHeader(outputFile);
  if (preservedSchema.length > 0) {
    let sql = `-- ${schemaDump ? "source" : "preserved"} table schemas; created before row replay\n`;
    for (const { table, createSql } of preservedSchema) {
      sql += `-- source table ${table}\n${createSql};\n`;
    }
    await writeFile(outputFile, sql, { flag: "a" });
  }
  if (ftsSchema.length > 0) {
    let sql = "-- external-content FTS5 tables\n";
    for (const { table, createSql } of ftsSchema) {
      sql += `-- FTS5 table ${table}\n${createSql};\n`;
    }
    await writeFile(outputFile, sql, { flag: "a" });
  }
  for (const table of targets) {
    try {
      const columns = (
        await query(`PRAGMA table_info(${quoteIdent(table)})`)
      ).results.map((row) => row.name);
      if (columns.length === 0) continue;
      const createSql = schemaDump
        ? (tableDdlByName.get(table) ?? "")
        : ((
            await query(
              `SELECT sql FROM sqlite_master WHERE name = ${formatValue(table)}`,
            )
          ).results[0]?.sql ?? "");
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
      if (offset !== count)
        throw new RecoveryConsistencyError(
          `Row count changed while dumping ${table}`,
        );
      dumped.push(table);
    } catch (error) {
      if (error instanceof RecoveryConsistencyError) throw error;
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
  if (schemaDump) {
    for (const { table } of ftsSchema) {
      await writeFile(
        outputFile,
        `INSERT INTO ${quoteIdent(table)} (${quoteIdent(table)}) VALUES ('rebuild');\n`,
        { flag: "a" },
      );
    }
    const hasSequence =
      (
        await query(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'sqlite_sequence'",
        )
      ).results.length > 0;
    if (hasSequence) {
      const sequences = (
        await query("SELECT name, seq FROM sqlite_sequence ORDER BY name")
      ).results;
      const seen = new Set();
      let sql = "-- preserve AUTOINCREMENT sequence values\n";
      for (const { name, seq } of sequences) {
        if (isPlatformTable(name)) continue;
        if (
          !targets.includes(name) ||
          seen.has(name) ||
          !Number.isSafeInteger(seq) ||
          seq < 0
        ) {
          throw new Error(
            `Refusing schema dump: sqlite_sequence contains an invalid table entry ${name}`,
          );
        }
        seen.add(name);
        const tableName = formatValue(name);
        const sequence = formatValue(seq);
        sql += `UPDATE sqlite_sequence SET seq = ${sequence} WHERE name = ${tableName};\n`;
        sql += `INSERT INTO sqlite_sequence(name, seq) SELECT ${tableName}, ${sequence} WHERE NOT EXISTS (SELECT 1 FROM sqlite_sequence WHERE name = ${tableName});\n`;
      }
      if (sequences.length > 0) {
        await writeFile(outputFile, sql, { flag: "a" });
      }
    }
  }
  if (preservedObjects.length > 0) {
    let sql =
      "-- preserved table indexes, triggers, and views; created after row replay\n";
    for (const object of preservedObjects) {
      sql += `-- ${object.type} ${object.name}\n${object.sql};\n`;
    }
    await writeFile(outputFile, sql, { flag: "a" });
  }
  return Object.freeze({
    method: schemaDump ? "schema-dump" : "table-dump",
    tables: dumped.length,
    rows: totalRows,
    skipped,
  });
}
