import { createPostgresPool, closePostgresPool } from "./pool";
import { assertPostgresText } from "./text-values";
import pg, { type PoolClient, type QueryResult } from "pg";
import { postgresParameters } from "./parameters";
import type { SqliteResult } from "../sqlite";

export type PostgresOptions = {
  connectionString: string;
  schema: "savia_core" | "savia_auth" | "savia_request";
  maxConnections: number;
};
function integer(value: string): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number))
    throw new RangeError(
      "PostgreSQL integer exceeds JavaScript safe integer range.",
    );
  return number;
}
function bindValue(value: unknown): string | number | null | Buffer {
  if (value === null) return value;
  if (typeof value === "string") {
    assertPostgresText(value);
    return value;
  }
  if (
    typeof value === "number" &&
    Number.isFinite(value) &&
    (!Number.isInteger(value) || Number.isSafeInteger(value))
  )
    return value;
  if (value instanceof ArrayBuffer) return Buffer.from(new Uint8Array(value));
  if (ArrayBuffer.isView(value))
    return Buffer.from(
      new Uint8Array(value.buffer, value.byteOffset, value.byteLength),
    );
  if (
    Array.isArray(value) &&
    value.every((v) => Number.isInteger(v) && v >= 0 && v <= 255)
  )
    return Buffer.from(value);
  throw new TypeError(
    "D1_TYPE_ERROR: SQL bindings must be safe numbers, strings, null or binary values.",
  );
}
function resultValue(value: unknown): unknown {
  return Buffer.isBuffer(value) ? Array.from(value) : value;
}

class PostgresStatement implements D1PreparedStatement {
  readonly text: string;
  readonly parameterCount: number;
  readonly values: ReturnType<typeof bindValue>[];
  constructor(
    readonly database: PostgresDatabase,
    readonly sql: string,
    values: unknown[] = [],
  ) {
    const parsed = postgresParameters(sql);
    this.text = parsed.text;
    this.parameterCount = parsed.parameterCount;
    this.values = values.map(bindValue);
  }
  bind(...values: unknown[]): PostgresStatement {
    if (values.length !== this.parameterCount)
      throw new Error("Incorrect SQL binding count.");
    return new PostgresStatement(this.database, this.sql, values);
  }
  async first<T = Record<string, unknown>>(column?: string): Promise<T | null> {
    const row = (await this.all<Record<string, unknown>>()).results[0];
    if (!row) return null;
    if (column === undefined) return row as T;
    if (!Object.hasOwn(row, column))
      throw new Error(`D1_COLUMN_NOTFOUND: ${column}`);
    return row[column] as T;
  }
  all<T = Record<string, unknown>>(): Promise<SqliteResult<T>> {
    return this.database.execute<T>(this);
  }
  run<T = Record<string, unknown>>(): Promise<SqliteResult<T>> {
    return this.all<T>();
  }
  raw<T = unknown[]>(options: {
    columnNames: true;
  }): Promise<[string[], ...T[]]>;
  raw<T = unknown[]>(options?: { columnNames?: false }): Promise<T[]>;
  async raw<T = unknown[]>(options?: { columnNames?: boolean }): Promise<T[]> {
    const result = await this.database.query(this);
    const rows = result.rows.map((row) => row.map(resultValue));
    if (options?.columnNames)
      rows.unshift(result.fields.map((field) => field.name));
    return rows as T[];
  }
}

/** A batch owns its connection until commit/rollback; no mutable transaction context. */
export class PostgresDatabase implements D1Database {
  readonly pool: pg.Pool;
  constructor(options: PostgresOptions) {
    if (!["savia_core", "savia_auth", "savia_request"].includes(options.schema))
      throw new Error("Invalid PostgreSQL schema.");
    if (
      !Number.isInteger(options.maxConnections) ||
      options.maxConnections < 1 ||
      options.maxConnections > 100
    )
      throw new Error("Invalid PostgreSQL pool size.");
    let connectionUrl: URL;
    try {
      connectionUrl = new URL(options.connectionString);
    } catch {
      throw new Error("Invalid PostgreSQL connection URL.");
    }
    if (connectionUrl.searchParams.has("options"))
      throw new Error(
        "PostgreSQL URL options must not override the trusted schema.",
      );
    this.pool = createPostgresPool({
      connectionString: options.connectionString,
      max: options.maxConnections,
      connectionTimeoutMillis: 10_000,
      options: `-c search_path=${options.schema},pg_catalog`,
      types: {
        getTypeParser(oid: number, format?: string) {
          if (format !== "binary" && oid === 20) return integer;
          // Numeric is exact decimal text, never a lossy implicit float conversion.
          return pg.types.getTypeParser(oid, format as "text" | "binary");
        },
      },
    });
  }
  prepare(sql: string): PostgresStatement {
    return new PostgresStatement(this, sql);
  }
  async query(
    statement: PostgresStatement,
    client?: PoolClient,
  ): Promise<QueryResult<unknown[]>> {
    if (statement.database !== this)
      throw new Error("Statement belongs to another database.");
    if (statement.values.length !== statement.parameterCount)
      throw new Error("Incorrect SQL binding count.");
    // Extended protocol disallows multi-command prepared statements even with no values.
    return (client ?? this.pool).query({
      text: statement.text,
      values: statement.values,
      rowMode: "array",
      queryMode: "extended",
    } as pg.QueryArrayConfig);
  }
  async execute<T>(
    statement: PostgresStatement,
    client?: PoolClient,
  ): Promise<SqliteResult<T>> {
    const started = performance.now();
    const result = await this.query(statement, client);
    const rows = result.rows.map((row) =>
      Object.fromEntries(
        result.fields.map((field, i) => [field.name, resultValue(row[i])]),
      ),
    );
    const changed = ["INSERT", "UPDATE", "DELETE", "MERGE"].includes(
      result.command,
    );
    const changes = changed ? (result.rowCount ?? 0) : 0;
    const id = result.command === "INSERT" ? rows.at(-1)?.id : undefined;
    return {
      success: true,
      results: rows as T[],
      meta: {
        duration: performance.now() - started,
        changes,
        // Only an explicit integer RETURNING id can supply generated-ID metadata.
        last_row_id:
          typeof id === "number" && Number.isSafeInteger(id) ? id : 0,
        changed_db: changes > 0,
        size_after: 0,
        rows_read: rows.length,
        rows_written: changes,
      },
    };
  }
  async batch<T = unknown>(
    statements: D1PreparedStatement[],
  ): Promise<SqliteResult<T>[]> {
    for (const statement of statements)
      if (
        !(statement instanceof PostgresStatement) ||
        statement.database !== this
      )
        throw new Error("Statement belongs to another database.");
    const client = await this.pool.connect();
    let broken: Error | undefined;
    try {
      await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
      const results: SqliteResult<T>[] = [];
      for (const statement of statements)
        results.push(
          await this.execute<T>(statement as PostgresStatement, client),
        );
      await client.query("COMMIT");
      return results;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        broken = rollbackError as Error;
      }
      throw error;
    } finally {
      client.release(broken);
    }
  }
  async exec(sql: string): Promise<{ count: number; duration: number }> {
    const started = performance.now();
    await this.batch([this.prepare(sql)]);
    return { count: 1, duration: performance.now() - started };
  }
  async dump(): Promise<ArrayBuffer> {
    throw new Error("PostgreSQL dump is not supported; use pg_dump.");
  }
  withSession(): D1DatabaseSession {
    throw new Error("PostgreSQL D1 sessions are not supported.");
  }
  close(): Promise<void> {
    return closePostgresPool(this.pool);
  }
}
export function openPostgresDatabase(
  options: PostgresOptions,
): PostgresDatabase {
  return new PostgresDatabase(options);
}
