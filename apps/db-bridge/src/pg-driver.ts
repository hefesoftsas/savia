import { createPostgresDatabaseDriver } from "./postgres-driver";
import { Pool, type PoolConfig } from "pg";
import {
  SQL_MAX_TABLES,
  type BridgeIntrospectColumnsResult,
  type BridgeQuery,
  type BridgeQueryResult,
  type BridgeTable,
} from "@savia/crm-shared/sql-sources";
import type { BridgeConnectionWithPassword, BridgeDriver } from "./driver";

const STATEMENT_TIMEOUT_MS = 10_000;

function fingerprint(connection: BridgeConnectionWithPassword): string {
  return JSON.stringify([
    connection.host,
    connection.port,
    connection.database,
    connection.username,
    connection.password,
    connection.ssl,
  ]);
}

function poolConfig(connection: BridgeConnectionWithPassword): PoolConfig {
  return {
    host: connection.host,
    port: connection.port,
    database: connection.database,
    user: connection.username,
    password: connection.password,
    ssl: connection.ssl ? { rejectUnauthorized: true } : undefined,
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    statement_timeout: STATEMENT_TIMEOUT_MS,
    query_timeout: STATEMENT_TIMEOUT_MS + 2_000,
    // Defensa en profundidad: el rol debería ser read-only en la base,
    // pero el puente nunca emite escrituras de todas formas.
    options: "-c default_transaction_read_only=on",
  };
}

/** pg devuelve Date/objetos/Buffer/bigint: normalizar a JSON escalar. */
export function serializeValue(
  value: unknown,
): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date)
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (Buffer.isBuffer(value)) return value.toString("base64");
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return null;
    }
  }
  return String(value);
}

const quote = (identifier: string): string =>
  `"${identifier.replaceAll('"', '""')}"`;

export function createPgDriver(): BridgeDriver {
  const pools = new Map<string, Pool>();
  const metadataDriver = createPostgresDatabaseDriver();

  function poolFor(connection: BridgeConnectionWithPassword): Pool {
    const key = fingerprint(connection);
    const existing = pools.get(key);
    if (existing) return existing;
    const created = new Pool(poolConfig(connection));
    created.on("error", () => {
      void created.end().catch(() => {});
      if (pools.get(key) === created) pools.delete(key);
    });
    if (pools.size >= 20) {
      const oldest = pools.keys().next().value as string | undefined;
      if (oldest) {
        const victim = pools.get(oldest);
        pools.delete(oldest);
        void victim?.end().catch(() => {});
      }
    }
    pools.set(key, created);
    return created;
  }

  return {
    async listTables(
      connection: BridgeConnectionWithPassword,
    ): Promise<BridgeTable[]> {
      const pool = poolFor(connection);
      const result = await pool.query(
        `SELECT t.schemaname AS schema,
                t.tablename AS table,
                'table' AS kind,
                c.reltuples::bigint AS "rowEstimate"
           FROM pg_tables t
           LEFT JOIN pg_class c ON c.relname = t.tablename
                AND c.relnamespace = quote_ident(t.schemaname)::regnamespace
          WHERE t.schemaname = $1
          UNION ALL
         SELECT v.schemaname AS schema,
                v.viewname AS table,
                'view' AS kind,
                NULL::bigint AS "rowEstimate"
           FROM pg_views v
          WHERE v.schemaname = $1
          ORDER BY 2
          LIMIT ${SQL_MAX_TABLES}`,
        [connection.schema],
      );
      return result.rows.map((row) => ({
        schema: String(row.schema),
        table: String(row.table),
        kind: row.kind === "view" ? ("view" as const) : ("table" as const),
        rowEstimate:
          row.rowEstimate === null || row.rowEstimate === undefined
            ? null
            : Math.max(0, Math.floor(Number(row.rowEstimate))),
      }));
    },

    async getColumns(
      connection: BridgeConnectionWithPassword,
      table: string,
    ): Promise<BridgeIntrospectColumnsResult> {
      const described = await metadataDriver.inspect(
        { ...connection, kind: "postgres" },
        table,
      );
      return {
        schema: connection.schema,
        table,
        kind: described.kind === "view" ? "view" : "table",
        primaryKey: described.primaryKey,
        columns: described.fields.map((f) => ({
          name: f.name,
          pgType: f.nativeType,
          nullable: f.nullable,
          isPrimaryKey: described.primaryKey.includes(f.name),
          isUnique: [described.primaryKey, ...described.uniqueKeys].some(
            (k) => k.length === 1 && k[0] === f.name,
          ),
          defaultValue: f.defaultValue ?? null,
        })),
      };
    },
    async close() {
      await Promise.all([...pools.values()].map((p) => p.end()));
      await metadataDriver.close();
    },

    async query(input: BridgeQuery): Promise<BridgeQueryResult> {
      const pool = poolFor(input.connection);
      if (input.operation === "read") {
        const built = buildReadQuery(input);
        const result = await pool.query(built.text, built.params as unknown[]);
        const row = result.rows[0] as Record<string, unknown> | undefined;
        if (!row) {
          const error = new Error("Registro no encontrado.");
          (error as { status?: number }).status = 404;
          throw error;
        }
        return {
          data: serializeRow(row),
          page: 1,
          perPage: 1,
          hasNext: false,
        };
      }
      const built = buildListQuery(input);
      const result = await pool.query(built.text, built.params as unknown[]);
      const rows = result.rows
        .slice(0, input.perPage)
        .map((row) => serializeRow(row as Record<string, unknown>));
      const total = (result.rows[0] as Record<string, unknown> | undefined)?.[
        "__total"
      ];
      return {
        data: rows,
        ...(total === undefined || total === null
          ? {}
          : { total: Math.max(0, Math.floor(Number(total))) }),
        page: input.page,
        perPage: input.perPage,
        hasNext: result.rows.length > input.perPage,
      };
    },
  };
}

function serializeRow(
  row: Record<string, unknown>,
): Record<string, string | number | boolean | null> {
  return Object.fromEntries(
    Object.entries(row)
      .filter(([key]) => key !== "__total")
      .map(([key, value]) => [key, serializeValue(value)]),
  );
}

export type BuiltQuery = { text: string; params: unknown[] };

/** Constructor puro (testeable sin Postgres): identificadores entrecomillados, valores parametrizados. */
export function buildReadQuery(input: BridgeQuery): BuiltQuery {
  const from = `${quote(input.connection.schema)}.${quote(input.table)}`;
  const idColumn = input.idColumn ?? "id";
  const selectColumns = (input.columns ?? [idColumn]).map(quote).join(", ");
  return {
    text: `SELECT ${selectColumns} FROM ${from} WHERE ${quote(idColumn)} = $1 LIMIT 2`,
    params: [input.id],
  };
}

export function buildListQuery(input: BridgeQuery): BuiltQuery {
  const from = `${quote(input.connection.schema)}.${quote(input.table)}`;
  const idColumn = input.idColumn ?? "id";
  const selectColumns = (input.columns ?? [idColumn]).map(quote).join(", ");
  const where: string[] = [];
  const params: unknown[] = [];
  for (const filter of input.filters) {
    if (filter.value === null) {
      where.push(`${quote(filter.field)} IS NULL`);
    } else {
      params.push(filter.value);
      where.push(`${quote(filter.field)} = $${params.length}`);
    }
  }
  if (input.search && input.searchColumns.length) {
    const escaped = input.search
      .replaceAll("\\", "\\\\")
      .replaceAll("%", "\\%")
      .replaceAll("_", "\\_");
    params.push(`%${escaped}%`);
    const placeholder = `$${params.length}`;
    where.push(
      `(${input.searchColumns
        .map(
          (column) => `${quote(column)}::text ILIKE ${placeholder} ESCAPE '\\'`,
        )
        .join(" OR ")})`,
    );
  }
  const predicate = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const orderColumn = input.sort ?? idColumn;
  const direction = input.order === "ASC" ? "ASC" : "DESC";
  const orderBy =
    `ORDER BY ${quote(orderColumn)} ${direction}` +
    (orderColumn === idColumn ? "" : `, ${quote(idColumn)} ${direction}`);
  params.push(input.perPage + 1, (input.page - 1) * input.perPage);
  return {
    text:
      `SELECT ${selectColumns}, COUNT(*) OVER() AS __total ` +
      `FROM ${from} ${predicate} ${orderBy} ` +
      `LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  };
}
