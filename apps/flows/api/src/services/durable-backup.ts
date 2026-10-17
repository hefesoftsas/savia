import type { Bindings } from "../context";

const PAGE_BYTES = 512 * 1024;
const PAGE_ROWS = 128;
function boundedPage<T>(page: T): T {
  if (new TextEncoder().encode(JSON.stringify(page)).byteLength > PAGE_BYTES)
    throw new Error("Backup page exceeds backup page limit");
  return page;
}
type Value = string | number | null | { blob: number[] };
export type BackupCheckpoint = {
  snapshotId: string;
  page: number;
  sha256: string;
};
export type BackupCursor = { table: number; offset: number };
export type SqlBackupPage = {
  version: 1;
  schema?: { name: string; sql: string; type: string }[];
  sqliteSequence?: { name: string; seq: number }[];
  table?: string;
  columns?: string[];
  rows: Value[][];
  next: BackupCursor | null;
};

export type EncodedKvValue =
  | null
  | boolean
  | number
  | string
  | EncodedKvValue[]
  | { [key: string]: EncodedKvValue }
  | { $saviaType: "array-buffer"; bytes: number[] }
  | { $saviaType: "typed-array"; constructor: string; bytes: number[] }
  | { $saviaType: "date"; value: string }
  | { $saviaType: "bigint"; value: string }
  | { $saviaType: "undefined" }
  | { $saviaType: "map"; entries: [EncodedKvValue, EncodedKvValue][] }
  | { $saviaType: "set"; values: EncodedKvValue[] }
  | { $saviaType: "object"; entries: [string, EncodedKvValue][] };
export type KvBackupPage = {
  version: 1;
  entries: { key: string; value: EncodedKvValue }[];
  next: string | null;
};

export type WorkflowBackupCursor =
  | { storage: "sql"; page: number; cursor?: BackupCursor }
  | { storage: "kv"; page: number; cursor?: string };
export type WorkflowBackupPage =
  | {
      version: 1;
      storage: "sql";
      segmentPage: number;
      segmentFirst: boolean;
      segmentLast: boolean;
      data: SqlBackupPage;
      next: WorkflowBackupCursor;
    }
  | {
      version: 1;
      storage: "kv";
      segmentPage: number;
      segmentFirst: boolean;
      segmentLast: boolean;
      data: KvBackupPage;
      next: WorkflowBackupCursor | null;
    };

export function encodeKvValue(value: unknown): EncodedKvValue {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new Error("Unsupported non-finite KV number");
    return value;
  }
  if (typeof value === "undefined") return { $saviaType: "undefined" };
  if (typeof value === "bigint")
    return { $saviaType: "bigint", value: value.toString() };
  if (value instanceof ArrayBuffer)
    return {
      $saviaType: "array-buffer",
      bytes: Array.from(new Uint8Array(value)),
    };
  if (ArrayBuffer.isView(value)) {
    return {
      $saviaType: "typed-array",
      constructor: value.constructor.name,
      bytes: Array.from(
        new Uint8Array(value.buffer, value.byteOffset, value.byteLength),
      ),
    };
  }
  if (value instanceof Date)
    return { $saviaType: "date", value: value.toISOString() };
  if (value instanceof Map)
    return {
      $saviaType: "map",
      entries: [...value].map(([key, item]) => [
        encodeKvValue(key),
        encodeKvValue(item),
      ]),
    };
  if (value instanceof Set)
    return { $saviaType: "set", values: [...value].map(encodeKvValue) };
  if (Array.isArray(value)) return value.map(encodeKvValue);
  if (typeof value === "object") {
    return {
      $saviaType: "object",
      entries: Object.entries(value).map(([key, item]) => [
        key,
        encodeKvValue(item),
      ]),
    };
  }
  throw new Error("Unsupported Durable Object KV value");
}

export function decodeKvValue(value: EncodedKvValue): unknown {
  if (Array.isArray(value)) return value.map(decodeKvValue);
  if (value && typeof value === "object") {
    if ("$saviaType" in value) {
      const tagged = value as {
        $saviaType: string;
        value?: string;
        bytes?: number[];
        constructor?: string;
        entries?: [EncodedKvValue, EncodedKvValue][];
        values?: EncodedKvValue[];
      };
      switch (tagged.$saviaType) {
        case "undefined":
          return undefined;
        case "bigint":
          return BigInt(tagged.value!);
        case "array-buffer":
          return new Uint8Array(tagged.bytes!).buffer;
        case "typed-array": {
          const bytes = new Uint8Array(tagged.bytes!).buffer;
          const constructors: Record<
            string,
            (buffer: ArrayBuffer) => ArrayBufferView
          > = {
            Int8Array: (buffer) => new Int8Array(buffer),
            Uint8Array: (buffer) => new Uint8Array(buffer),
            Uint8ClampedArray: (buffer) => new Uint8ClampedArray(buffer),
            Int16Array: (buffer) => new Int16Array(buffer),
            Uint16Array: (buffer) => new Uint16Array(buffer),
            Int32Array: (buffer) => new Int32Array(buffer),
            Uint32Array: (buffer) => new Uint32Array(buffer),
            Float32Array: (buffer) => new Float32Array(buffer),
            Float64Array: (buffer) => new Float64Array(buffer),
            BigInt64Array: (buffer) => new BigInt64Array(buffer),
            BigUint64Array: (buffer) => new BigUint64Array(buffer),
            DataView: (buffer) => new DataView(buffer),
          };
          const make = constructors[tagged.constructor!];
          if (!make) throw new Error("Unsupported typed KV value");
          return make(bytes);
        }
        case "date":
          return new Date(tagged.value!);
        case "map":
          return new Map(
            tagged.entries!.map(([key, item]) => [
              decodeKvValue(key),
              decodeKvValue(item),
            ]),
          );
        case "set":
          return new Set(tagged.values!.map(decodeKvValue));
        case "object":
          return Object.fromEntries(
            (tagged.entries as [string, EncodedKvValue][]).map(
              ([key, item]) => [key, decodeKvValue(item)],
            ),
          );
      }
    }
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        decodeKvValue(item as EncodedKvValue),
      ]),
    );
  }
  return value;
}

export async function exportKvPage(
  storage: DurableObjectStorage,
  startAfter?: string,
): Promise<KvBackupPage> {
  const rows = await storage.list({
    ...(startAfter ? { startAfter } : {}),
    limit: PAGE_ROWS + 2,
  });
  const entries: KvBackupPage["entries"] = [];
  let bytes = 0;
  for (const [key, value] of rows) {
    if (key === "__savia_backup_restore") continue;
    if (entries.length >= PAGE_ROWS) break;
    const entry = { key, value: encodeKvValue(value) };
    const size = new TextEncoder().encode(JSON.stringify(entry)).byteLength;
    if (size > PAGE_BYTES)
      throw new Error("Durable Object KV value exceeds backup page limit");
    if (bytes + size > PAGE_BYTES && entries.length > 0) break;
    entries.push(entry);
    bytes += size;
  }
  const lastKey = entries.at(-1)?.key;
  const hasMore =
    lastKey !== undefined &&
    [...rows.keys()].some(
      (key) => key !== "__savia_backup_restore" && key > lastKey,
    );
  return boundedPage<KvBackupPage>({
    version: 1,
    entries,
    next: hasMore ? lastKey! : null,
  });
}

/** WorkflowAgent state spans SQLite and ordinary Durable Object KV storage. */
export async function exportWorkflowBackupPage(
  storage: DurableObjectStorage,
  cursor?: WorkflowBackupCursor,
): Promise<WorkflowBackupPage> {
  if (!cursor || cursor.storage === "sql") {
    const segmentPage = cursor?.page ?? 0;
    if (!Number.isSafeInteger(segmentPage) || segmentPage < 0)
      throw new Error("Invalid workflow backup cursor");
    const data = exportSqlPage(storage.sql, cursor?.cursor);
    const segmentLast = data.next === null;
    return boundedPage<WorkflowBackupPage>({
      version: 1,
      storage: "sql",
      segmentPage,
      segmentFirst: segmentPage === 0,
      segmentLast,
      data,
      next: data.next
        ? { storage: "sql", page: segmentPage + 1, cursor: data.next }
        : { storage: "kv", page: 0 },
    });
  }
  const segmentPage = cursor.page;
  if (!Number.isSafeInteger(segmentPage) || segmentPage < 0)
    throw new Error("Invalid workflow backup cursor");
  const data = await exportKvPage(storage, cursor.cursor);
  return boundedPage<WorkflowBackupPage>({
    version: 1,
    storage: "kv",
    segmentPage,
    segmentFirst: segmentPage === 0,
    segmentLast: data.next === null,
    data,
    next: data.next
      ? { storage: "kv", page: segmentPage + 1, cursor: data.next }
      : null,
  });
}

export async function restoreKvPage(
  storage: DurableObjectStorage,
  page: KvBackupPage,
  first: boolean,
  checkpoint?: BackupCheckpoint,
): Promise<void> {
  if (
    page.version !== 1 ||
    !Array.isArray(page.entries) ||
    new TextEncoder().encode(JSON.stringify(page)).byteLength > 2 * PAGE_BYTES
  )
    throw new Error("Invalid KV backup page");
  const checkpointKey = "__savia_backup_restore";
  if (checkpoint) {
    if (
      !/^[A-Za-z0-9-]{1,80}$/.test(checkpoint.snapshotId) ||
      !Number.isSafeInteger(checkpoint.page) ||
      checkpoint.page < 0 ||
      !/^[a-f0-9]{64}$/.test(checkpoint.sha256)
    )
      throw new Error("Invalid restore checkpoint");
  }
  await storage.transaction(async (transaction) => {
    const checkpoints =
      (await transaction.get<Record<string, { page: number; sha256: string }>>(
        checkpointKey,
      )) ?? {};
    if (checkpoint) {
      const key = `${checkpoint.snapshotId}:${checkpoint.page}`;
      const prior = checkpoints[key];
      if (prior) {
        if (prior.sha256 !== checkpoint.sha256)
          throw new Error("Restore checkpoint checksum mismatch");
        return;
      }
      const pages = Object.entries(checkpoints)
        .filter(([entry]) => entry.startsWith(`${checkpoint.snapshotId}:`))
        .map(([, value]) => value.page);
      if (checkpoint.page !== (pages.length ? Math.max(...pages) + 1 : 0))
        throw new Error("Restore pages must be applied in order");
    }
    if (
      first &&
      [...(await transaction.list({ limit: 2 }))].some(
        ([key]) => key !== checkpointKey,
      )
    )
      throw new Error("Restore target must be empty");
    for (const entry of page.entries) {
      if (!entry || typeof entry.key !== "string" || !entry.key.length)
        throw new Error("Invalid KV backup entry");
      if ((await transaction.get(entry.key)) !== undefined)
        throw new Error("Restore target must be empty");
      await transaction.put(entry.key, decodeKvValue(entry.value));
    }
    if (checkpoint) {
      checkpoints[`${checkpoint.snapshotId}:${checkpoint.page}`] = {
        page: checkpoint.page,
        sha256: checkpoint.sha256,
      };
      await transaction.put(checkpointKey, checkpoints);
    }
  });
}

export function assertPausedMaintenance(
  env: Pick<
    Bindings,
    "SAVIA_FLOWS_EXECUTION_ENABLED" | "SAVIA_FLOWS_MAINTENANCE"
  >,
): void {
  if (
    env.SAVIA_FLOWS_EXECUTION_ENABLED !== "false" ||
    env.SAVIA_FLOWS_MAINTENANCE !== "true"
  ) {
    throw new Error("Flows must be paused in maintenance mode");
  }
}

const quoted = (name: string) => `"${name.replaceAll('"', '""')}"`;
const schemaOf = (sql: SqlStorage) =>
  sql
    .exec<{ name: string; sql: string; type: string }>(
      "SELECT name,sql,type FROM sqlite_master WHERE sql IS NOT NULL AND substr(name,1,7) != 'sqlite_' AND substr(name,1,4) != '_cf_' AND name NOT IN ('__savia_backup_restore','__savia_backup_restore_workflow') ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END,name",
    )
    .toArray();

/** Bounded pages keep backup/restore off the local and Worker memory hot paths. */
export function exportSqlPage(
  sql: SqlStorage,
  cursor: BackupCursor = { table: 0, offset: 0 },
): SqlBackupPage {
  if (
    !Number.isSafeInteger(cursor.table) ||
    cursor.table < 0 ||
    !Number.isSafeInteger(cursor.offset) ||
    cursor.offset < 0
  )
    throw new Error("Invalid backup cursor");
  const schema = schemaOf(sql);
  if (schema.some((entry) => /^CREATE\s+VIRTUAL/i.test(entry.sql)))
    throw new Error(
      "Virtual table backup is unsupported; refusing a partial snapshot",
    );
  const tables = schema.filter((entry) => entry.type === "table");
  const first = cursor.table === 0 && cursor.offset === 0;
  const sqliteSequence =
    first && tables.some((entry) => /AUTOINCREMENT/i.test(entry.sql))
      ? sql
          .exec<{ name: string; seq: number }>(
            "SELECT name,seq FROM sqlite_sequence ORDER BY name",
          )
          .toArray()
      : undefined;
  if (cursor.table >= tables.length)
    return boundedPage<SqlBackupPage>({
      version: 1,
      ...(first ? { schema } : {}),
      ...(sqliteSequence ? { sqliteSequence } : {}),
      rows: [],
      next: null,
    });
  const table = tables[cursor.table].name;
  const columns = sql
    .exec<{ name: string }>(`PRAGMA table_info(${quoted(table)})`)
    .toArray()
    .map((column) => column.name);
  const rows: Value[][] = [];
  let bytes = first
    ? new TextEncoder().encode(JSON.stringify({ schema, sqliteSequence }))
        .byteLength
    : 0;
  if (bytes > PAGE_BYTES)
    throw new Error("Database schema exceeds backup page limit");
  for (const row of sql.exec(
    `SELECT * FROM ${quoted(table)} LIMIT ? OFFSET ?`,
    PAGE_ROWS,
    cursor.offset,
  )) {
    const values = columns.map((column) => {
      const value = row[column];
      return value instanceof ArrayBuffer
        ? { blob: Array.from(new Uint8Array(value)) }
        : (value as string | number | null);
    });
    const size = new TextEncoder().encode(JSON.stringify(values)).byteLength;
    if (size > PAGE_BYTES)
      throw new Error("Database row exceeds backup page limit");
    if (bytes + size > PAGE_BYTES && rows.length > 0) break;
    rows.push(values);
    bytes += size;
  }
  const next =
    rows.length > 0
      ? { table: cursor.table, offset: cursor.offset + rows.length }
      : cursor.table + 1 < tables.length
        ? { table: cursor.table + 1, offset: 0 }
        : null;
  return boundedPage<SqlBackupPage>({
    version: 1,
    ...(first ? { schema } : {}),
    ...(sqliteSequence ? { sqliteSequence } : {}),
    table,
    columns,
    rows,
    next,
  });
}

function assertSqlBackupPage(page: SqlBackupPage): void {
  if (
    page.version !== 1 ||
    !Array.isArray(page.rows) ||
    new TextEncoder().encode(JSON.stringify(page)).byteLength > 2 * PAGE_BYTES
  )
    throw new Error("Invalid SQL backup page");
}

function assertRestoreCheckpoint(checkpoint: BackupCheckpoint): void {
  if (
    !/^[A-Za-z0-9-]{1,80}$/.test(checkpoint.snapshotId) ||
    !Number.isSafeInteger(checkpoint.page) ||
    checkpoint.page < 0 ||
    !/^[a-f0-9]{64}$/.test(checkpoint.sha256)
  )
    throw new Error("Invalid restore checkpoint");
}

function assertEmptySqlTarget(
  sql: SqlStorage,
  schema: SqlBackupPage["schema"],
): void {
  if (!schema || !Array.isArray(schema))
    throw new Error("Backup schema required");
  // Restoring into a populated object is deliberately forbidden. A restore is
  // performed into empty resources or after a separately controlled reset.
  const existingTables = schemaOf(sql).filter(
    (entry) => entry.type === "table",
  );
  const populatedApplicationTables = existingTables.filter((entry) => {
    const count = Number(
      sql.exec(`SELECT count(*) AS count FROM ${quoted(entry.name)}`).one()
        .count,
    );
    if (count === 0) return false;
    if (entry.name === "cf_agents_state") {
      const rows = sql
        .exec<{ id: string; state: string | null }>(
          "SELECT id,state FROM cf_agents_state",
        )
        .toArray();
      return (
        rows.length > 1 ||
        rows.some((row) => row.id !== "cf_schema_version" || row.state !== "11")
      );
    }
    return true;
  });
  if (populatedApplicationTables.length > 0)
    throw new Error("Restore target must be empty");
}

function restoreSqlData(
  sql: SqlStorage,
  page: SqlBackupPage,
  first: boolean,
  last: boolean,
): void {
  if (first) {
    assertEmptySqlTarget(sql, page.schema);
    const existingTables = schemaOf(sql).filter(
      (entry) => entry.type === "table",
    );
    // Preserve Agent SDK bootstrap tables, clearing only their bootstrap rows.
    for (const entry of existingTables) {
      if (entry.name.startsWith("cf_agents_"))
        sql.exec(`DELETE FROM ${quoted(entry.name)}`);
      else sql.exec(`DROP TABLE ${quoted(entry.name)}`);
    }
    for (const entry of page.schema!.filter((entry) => entry.type === "table"))
      sql.exec(
        entry.sql.replace(/^CREATE TABLE\s+/i, "CREATE TABLE IF NOT EXISTS "),
      );
  }
  if (page.rows.length) {
    if (!page.table || !page.columns?.length)
      throw new Error("Backup table and columns required");
    for (const row of page.rows) {
      if (row.length !== page.columns.length)
        throw new Error("Invalid backup row");
      sql.exec(
        `INSERT INTO ${quoted(page.table)} (${page.columns.map(quoted).join(",")}) VALUES (${row.map(() => "?").join(",")})`,
        ...row.map((value) =>
          value !== null && typeof value === "object"
            ? new Uint8Array(value.blob).buffer
            : value,
        ),
      );
    }
  }
  if (last && page.schema)
    for (const entry of page.schema.filter((entry) => entry.type !== "table")) {
      const ddl = entry.sql
        .replace(
          /^CREATE UNIQUE INDEX\s+/i,
          "CREATE UNIQUE INDEX IF NOT EXISTS ",
        )
        .replace(/^CREATE INDEX\s+/i, "CREATE INDEX IF NOT EXISTS ")
        .replace(/^CREATE TRIGGER\s+/i, "CREATE TRIGGER IF NOT EXISTS ");
      sql.exec(ddl);
    }
  if (last && page.sqliteSequence)
    for (const { name, seq } of page.sqliteSequence) {
      sql.exec("DELETE FROM sqlite_sequence WHERE name=?", name);
      sql.exec("INSERT INTO sqlite_sequence(name,seq) VALUES(?,?)", name, seq);
    }
  if (last && sql.exec("PRAGMA foreign_key_check").toArray().length > 0)
    throw new Error("Restore contains unresolved foreign-key references");
}

export function restoreSqlPage(
  storage: DurableObjectStorage,
  page: SqlBackupPage,
  first: boolean,
  last: boolean,
  checkpoint?: BackupCheckpoint,
): void {
  assertSqlBackupPage(page);
  if (
    checkpoint &&
    checkpointAlreadyApplied(storage.sql, "__savia_backup_restore", checkpoint)
  )
    return;
  if (first) storage.sql.exec("PRAGMA foreign_keys = OFF");
  try {
    storage.transactionSync(() => {
      const sql = storage.sql;
      if (checkpoint) {
        assertRestoreCheckpoint(checkpoint);
        sql.exec(
          "CREATE TABLE IF NOT EXISTS __savia_backup_restore (snapshot_id TEXT NOT NULL, page INTEGER NOT NULL, sha256 TEXT NOT NULL, PRIMARY KEY(snapshot_id,page))",
        );
        const previous = sql
          .exec(
            "SELECT MAX(page) AS page FROM __savia_backup_restore WHERE snapshot_id=?",
            checkpoint.snapshotId,
          )
          .one().page;
        if (checkpoint.page !== (previous === null ? 0 : Number(previous) + 1))
          throw new Error("Restore pages must be applied in order");
      }
      restoreSqlData(sql, page, first, last);
      if (checkpoint)
        sql.exec(
          "INSERT INTO __savia_backup_restore VALUES (?,?,?)",
          checkpoint.snapshotId,
          checkpoint.page,
          checkpoint.sha256,
        );
    });
  } catch (error) {
    if (first) storage.sql.exec("PRAGMA foreign_keys = ON");
    throw error;
  }
  if (last) storage.sql.exec("PRAGMA foreign_keys = ON");
}

function checkpointAlreadyApplied(
  sql: SqlStorage,
  table: "__savia_backup_restore" | "__savia_backup_restore_workflow",
  checkpoint: BackupCheckpoint,
): boolean {
  assertRestoreCheckpoint(checkpoint);
  const exists = sql
    .exec<{ present: number }>(
      "SELECT 1 AS present FROM sqlite_master WHERE type='table' AND name=?",
      table,
    )
    .toArray()[0];
  if (!exists) return false;
  const prior = sql
    .exec<{ sha256: string }>(
      `SELECT sha256 FROM ${table} WHERE snapshot_id=? AND page=?`,
      checkpoint.snapshotId,
      checkpoint.page,
    )
    .toArray()[0];
  if (!prior) return false;
  if (prior.sha256 !== checkpoint.sha256)
    throw new Error("Restore checkpoint checksum mismatch");
  return true;
}

export function restoreWorkflowBackupPage(
  storage: DurableObjectStorage,
  page: WorkflowBackupPage,
  checkpoint: BackupCheckpoint,
): void {
  assertRestoreCheckpoint(checkpoint);
  if (
    page.version !== 1 ||
    !Number.isSafeInteger(page.segmentPage) ||
    page.segmentPage < 0 ||
    page.segmentFirst !== (page.segmentPage === 0) ||
    page.segmentLast !== (page.data.next === null) ||
    new TextEncoder().encode(JSON.stringify(page)).byteLength > 2 * PAGE_BYTES
  )
    throw new Error("Invalid mixed workflow backup page");
  if (page.storage !== "sql" && page.storage !== "kv")
    throw new Error("Invalid mixed workflow backup storage kind");
  if (page.storage === "sql") {
    assertSqlBackupPage(page.data);
    const expectedNext = page.data.next
      ? {
          storage: "sql" as const,
          page: page.segmentPage + 1,
          cursor: page.data.next,
        }
      : { storage: "kv" as const, page: 0 };
    if (JSON.stringify(page.next) !== JSON.stringify(expectedNext))
      throw new Error("Invalid mixed workflow backup cursor");
  } else {
    if (
      page.data.version !== 1 ||
      !Array.isArray(page.data.entries) ||
      new TextEncoder().encode(JSON.stringify(page.data)).byteLength >
        2 * PAGE_BYTES
    )
      throw new Error("Invalid mixed workflow backup page");
    const expectedNext = page.data.next
      ? {
          storage: "kv" as const,
          page: page.segmentPage + 1,
          cursor: page.data.next,
        }
      : null;
    if (JSON.stringify(page.next) !== JSON.stringify(expectedNext))
      throw new Error("Invalid mixed workflow backup cursor");
  }

  const sql = storage.sql;
  if (
    checkpointAlreadyApplied(sql, "__savia_backup_restore_workflow", checkpoint)
  )
    return;
  if (page.storage === "sql" && page.segmentFirst)
    sql.exec("PRAGMA foreign_keys = OFF");
  try {
    storage.transactionSync(() => {
      sql.exec(
        "CREATE TABLE IF NOT EXISTS __savia_backup_restore_workflow (snapshot_id TEXT NOT NULL, page INTEGER NOT NULL, sha256 TEXT NOT NULL, storage TEXT NOT NULL, segment_page INTEGER NOT NULL, segment_last INTEGER NOT NULL, PRIMARY KEY(snapshot_id,page))",
      );
      const prior = sql
        .exec<{ sha256: string }>(
          "SELECT sha256 FROM __savia_backup_restore_workflow WHERE snapshot_id=? AND page=?",
          checkpoint.snapshotId,
          checkpoint.page,
        )
        .toArray()[0];
      if (prior) {
        if (prior.sha256 !== checkpoint.sha256)
          throw new Error("Restore checkpoint checksum mismatch");
        return;
      }
      const previous = sql
        .exec<{
          page: number;
          storage: "sql" | "kv";
          segment_page: number;
          segment_last: number;
        }>(
          "SELECT page,storage,segment_page,segment_last FROM __savia_backup_restore_workflow WHERE snapshot_id=? ORDER BY page DESC LIMIT 1",
          checkpoint.snapshotId,
        )
        .toArray()[0];
      if (checkpoint.page !== (previous ? previous.page + 1 : 0))
        throw new Error("Restore pages must be applied in order");
      if (!previous) {
        if (page.storage !== "sql" || page.segmentPage !== 0)
          throw new Error("Workflow restore must begin with SQLite page zero");
        assertEmptySqlTarget(sql, page.data.schema);
        if ([...storage.kv.list({ limit: 1 })].length > 0)
          throw new Error("Restore target must be empty");
      } else if (page.storage === "sql") {
        if (
          previous.storage !== "sql" ||
          previous.segment_last !== 0 ||
          page.segmentPage !== previous.segment_page + 1
        )
          throw new Error("SQLite restore pages must be applied before KV");
      } else if (previous.storage === "sql") {
        if (previous.segment_last !== 1 || page.segmentPage !== 0)
          throw new Error("KV restore must follow final SQLite page");
      } else if (
        previous.storage !== "kv" ||
        previous.segment_last !== 0 ||
        page.segmentPage !== previous.segment_page + 1
      ) {
        throw new Error("Restore pages must be applied in order");
      }

      if (page.storage === "sql") {
        restoreSqlData(sql, page.data, page.segmentFirst, page.segmentLast);
      } else {
        for (const entry of page.data.entries) {
          if (
            !entry ||
            typeof entry.key !== "string" ||
            !entry.key.length ||
            entry.key === "__savia_backup_restore"
          )
            throw new Error("Invalid KV backup entry");
          if (
            [
              ...storage.kv.list({
                start: entry.key,
                end: `${entry.key}\u0000`,
                limit: 1,
              }),
            ].length > 0
          )
            throw new Error("Restore target must be empty");
          storage.kv.put(entry.key, decodeKvValue(entry.value));
        }
      }
      sql.exec(
        "INSERT INTO __savia_backup_restore_workflow VALUES (?,?,?,?,?,?)",
        checkpoint.snapshotId,
        checkpoint.page,
        checkpoint.sha256,
        page.storage,
        page.segmentPage,
        page.segmentLast ? 1 : 0,
      );
    });
  } catch (error) {
    if (page.storage === "sql" && page.segmentFirst)
      sql.exec("PRAGMA foreign_keys = ON");
    throw error;
  }
  if (page.storage === "sql" && page.segmentLast)
    sql.exec("PRAGMA foreign_keys = ON");
}
