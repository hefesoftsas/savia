import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

export type SqliteResult<T = Record<string, unknown>> = {
  success: true;
  results: T[];
  meta: {
    duration: number;
    changes: number;
    last_row_id: number;
    changed_db: boolean;
    size_after: number;
    rows_read: number;
    rows_written: number;
  };
};

function bindValue(value: unknown): SQLInputValue {
  if (value === null || typeof value === "string" || typeof value === "number")
    return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value))
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (
    Array.isArray(value) &&
    value.every((v) => Number.isInteger(v) && v >= 0 && v <= 255)
  )
    return new Uint8Array(value);
  throw new TypeError(
    "D1_TYPE_ERROR: SQL bindings must be strings, numbers, null or binary values.",
  );
}
function resultValue(value: unknown): unknown {
  return value instanceof Uint8Array ? Array.from(value) : value;
}

class SqliteStatement implements D1PreparedStatement {
  readonly database: SqliteDatabase;
  readonly sql: string;
  readonly parameters: SQLInputValue[];
  constructor(
    database: SqliteDatabase,
    sql: string,
    parameters: SQLInputValue[] = [],
  ) {
    this.database = database;
    this.sql = sql;
    this.parameters = parameters;
  }
  bind(...values: unknown[]): SqliteStatement {
    return new SqliteStatement(this.database, this.sql, values.map(bindValue));
  }
  async first<T = Record<string, unknown>>(column?: string): Promise<T | null> {
    const rows = this.database.execute<Record<string, unknown>>(this).results;
    const row = rows[0];
    if (!row) return null;
    if (column !== undefined) {
      if (!Object.hasOwn(row, column))
        throw new Error(`D1_COLUMN_NOTFOUND: ${column}`);
      return row[column] as T;
    }
    return row as T;
  }
  async all<T = Record<string, unknown>>(): Promise<SqliteResult<T>> {
    return this.database.execute<T>(this);
  }
  async run<T = Record<string, unknown>>(): Promise<SqliteResult<T>> {
    return this.database.execute<T>(this);
  }
  raw<T = unknown[]>(options: {
    columnNames: true;
  }): Promise<[string[], ...T[]]>;
  raw<T = unknown[]>(options?: { columnNames?: false }): Promise<T[]>;
  async raw<T = unknown[]>(options?: { columnNames?: boolean }): Promise<T[]> {
    return this.database.raw<T>(this, options?.columnNames ?? false);
  }
}

/** One synchronous connection owns each database; batch execution cannot interleave requests. */
export class SqliteDatabase implements D1Database {
  private readonly connection: DatabaseSync;
  private closed = false;
  constructor(path: string) {
    this.connection = new DatabaseSync(path);
    this.connection.exec(
      "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL;",
    );
  }
  prepare(sql: string): SqliteStatement {
    return new SqliteStatement(this, sql);
  }
  execute<T>(query: SqliteStatement): SqliteResult<T> {
    if (query.database !== this)
      throw new Error("Statement belongs to another database.");
    const started = performance.now();
    const before = this.connection.prepare("SELECT total_changes() AS n").get()!
      .n as number;
    const statement = this.connection.prepare(query.sql);
    const rows = statement.all(...query.parameters);
    // SELECTs leave changes() untouched, so total_changes distinguishes reads.
    const stats = this.connection
      .prepare(
        "SELECT changes() AS changes, last_insert_rowid() AS id, total_changes() AS total",
      )
      .get()!;
    const written = Number(stats.total) - before;
    return {
      success: true,
      results: rows.map((row) =>
        Object.fromEntries(
          Object.entries(row).map(([key, value]) => [key, resultValue(value)]),
        ),
      ) as T[],
      meta: {
        duration: performance.now() - started,
        changes: written ? Number(stats.changes) : 0,
        last_row_id: Number(stats.id),
        changed_db: written > 0,
        size_after: 0,
        rows_read: rows.length,
        rows_written: written,
      },
    };
  }
  raw<T>(query: SqliteStatement, columnNames: boolean): T[] {
    const statement = this.connection.prepare(query.sql);
    statement.setReturnArrays(true);
    const rows = statement.all(...query.parameters) as unknown as unknown[][];
    const result = rows.map((row) => row.map(resultValue));
    if (columnNames)
      result.unshift(statement.columns().map((column) => column.name));
    return result as T[];
  }
  private atomic<T>(run: () => T): T {
    this.connection.exec("BEGIN IMMEDIATE");
    try {
      const result = run();
      this.connection.exec("COMMIT");
      return result;
    } catch (error) {
      // RAISE(ROLLBACK) in a trigger may have already ended this transaction.
      if (this.connection.isTransaction) this.connection.exec("ROLLBACK");
      throw error;
    }
  }
  async batch<T = unknown>(
    queries: D1PreparedStatement[],
  ): Promise<SqliteResult<T>[]> {
    return this.atomic(() =>
      queries.map((query) => {
        if (!(query instanceof SqliteStatement))
          throw new Error("Statement belongs to another database.");
        return this.execute<T>(query);
      }),
    );
  }
  async exec(sql: string): Promise<{ count: number; duration: number }> {
    const started = performance.now();
    this.atomic(() => this.connection.exec(sql));
    return { count: 1, duration: performance.now() - started };
  }
  /** Files are ordered exactly like the existing D1 migration runner, including equal prefixes. */
  async migrate(directory: string): Promise<string[]> {
    const files = readdirSync(directory)
      .filter((file) => file.endsWith(".sql"))
      .sort();
    const migrations = files.map((filename) => {
      const sql = readFileSync(join(directory, filename), "utf8");
      return {
        filename,
        sql,
        checksum: createHash("sha256").update(sql).digest("hex"),
      };
    });
    this.connection.exec(`CREATE TABLE IF NOT EXISTS _savia_sqlite_migrations (
      position INTEGER PRIMARY KEY, filename TEXT NOT NULL UNIQUE,
      checksum TEXT NOT NULL, applied_at TEXT NOT NULL
    )`);
    const applied: string[] = [];
    this.atomic(() => {
      const history = this.connection
        .prepare(
          "SELECT position,filename,checksum FROM _savia_sqlite_migrations ORDER BY position",
        )
        .all();
      const available = new Map(
        migrations.map((migration) => [migration.filename, migration]),
      );
      const completed = new Set<string>();
      for (const [index, row] of history.entries()) {
        const filename = String(row.filename);
        const migration = available.get(filename);
        if (!migration || row.position !== index)
          throw new Error(
            `Migration history is invalid or file is missing: ${filename}.`,
          );
        if (row.checksum !== migration.checksum)
          throw new Error(`Migration checksum changed: ${migration.filename}.`);
        completed.add(filename);
      }
      // Parallel branches can introduce an earlier filename. Like D1, apply only
      // pending files in filename order and retain the actual execution history.
      let position = history.length;
      for (const migration of migrations) {
        if (completed.has(migration.filename)) continue;
        // SQLite parses whole scripts, preserving semicolons inside trigger bodies.
        this.connection.exec(migration.sql);
        this.connection
          .prepare("INSERT INTO _savia_sqlite_migrations VALUES(?,?,?,?)")
          .run(
            position++,
            migration.filename,
            migration.checksum,
            new Date().toISOString(),
          );
        applied.push(migration.filename);
      }
    });
    return applied;
  }
  withSession(_constraintOrBookmark?: string): D1DatabaseSession {
    // There are no replicas: every query on this connection sees all committed writes.
    return {
      prepare: (sql) => this.prepare(sql),
      batch: (queries) => this.batch(queries),
      getBookmark: () => null,
    };
  }
  async dump(): Promise<ArrayBuffer> {
    throw new Error(
      "D1 alpha dump is unsupported. Use the SQLite online backup API for self-hosted backups.",
    );
  }
  close(): void {
    if (this.closed) return;
    this.connection.close();
    this.closed = true;
  }
}

export function openSqliteDatabase(path: string): SqliteDatabase {
  return new SqliteDatabase(path);
}
