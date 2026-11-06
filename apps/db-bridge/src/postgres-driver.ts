import { Pool } from "pg";
import type {
  DatabaseConnection,
  ResourceMetadata,
} from "@savia/studio-shared/database-sources";
import { ConnectionPools, leasePool } from "./connection-pools";
import { createRelationalDriver, type SqlSession } from "./relational-driver";
import { fieldType } from "./database-values";
import { DatabaseBridgeError } from "./database-errors";
export async function inspectPostgres(
  s: SqlSession,
  c: DatabaseConnection,
  resource: string,
): Promise<ResourceMetadata> {
  if (c.kind !== "postgres") throw new Error("Invalid driver");
  const columns = await s.query(
    `SELECT c.column_name AS name,c.udt_name AS native_type,c.is_nullable,c.column_default,c.is_identity,c.is_generated,t.table_type FROM information_schema.columns c JOIN information_schema.tables t ON t.table_schema=c.table_schema AND t.table_name=c.table_name WHERE c.table_schema=$1 AND c.table_name=$2 ORDER BY c.ordinal_position`,
    [c.schema, resource],
  );
  if (!columns.rows.length)
    throw new DatabaseBridgeError(
      "DATABASE_NOT_FOUND",
      "Resource not found.",
      404,
    );
  const keys = await s.query(
    `SELECT tc.constraint_name,tc.constraint_type,k.column_name FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage k ON k.constraint_catalog=tc.constraint_catalog AND k.constraint_schema=tc.constraint_schema AND k.constraint_name=tc.constraint_name AND k.table_name=tc.table_name WHERE tc.table_schema=$1 AND tc.table_name=$2 AND tc.constraint_type IN ('PRIMARY KEY','UNIQUE') ORDER BY tc.constraint_name,k.ordinal_position`,
    [c.schema, resource],
  );
  const groups = new Map<string, { type: string; columns: string[] }>();
  for (const k of keys.rows) {
    const name = String(k.constraint_name);
    const group = groups.get(name) ?? {
      type: String(k.constraint_type),
      columns: [],
    };
    group.columns.push(String(k.column_name));
    groups.set(name, group);
  }
  return {
    resource,
    kind: columns.rows[0]?.table_type === "VIEW" ? "view" : "table",
    sampled: false,
    fields: columns.rows.map((r) => {
      const type = fieldType(String(r.native_type));
      const generated =
        r.is_identity === "YES" ||
        (r.is_generated !== "NEVER" && r.is_generated !== undefined) ||
        String(r.column_default ?? "").startsWith("nextval(");
      return {
        name: String(r.name),
        nativeType: String(r.native_type),
        valueType: type,
        nullable: r.is_nullable === "YES",
        generated,
        writable: !generated && !["unsupported", "binary"].includes(type),
        hasDefault: r.column_default != null || generated,
        defaultValue:
          r.column_default == null ? null : String(r.column_default),
      };
    }),
    primaryKey:
      [...groups.values()].find((k) => k.type === "PRIMARY KEY")?.columns ?? [],
    uniqueKeys: [...groups.values()]
      .filter((k) => k.type === "UNIQUE")
      .map((k) => k.columns),
  };
}
export function createPostgresDatabaseDriver() {
  const pools = new ConnectionPools(
    async (key) => {
      const c = JSON.parse(key);
      const pool = new Pool({
        host: c.host,
        port: c.port,
        database: c.database,
        user: c.username,
        password: c.password,
        ssl: c.ssl ? { rejectUnauthorized: true } : undefined,
        max: 5,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
        statement_timeout: 10000,
        query_timeout: 12000,
      });
      pool.on("error", () => {});
      return pool;
    },
    async (p) => p.end(),
  );
  return createRelationalDriver({
    kind: "postgres",
    close: () => pools.close(),
    inspect: inspectPostgres,
    list: async (s, c) => {
      if (c.kind !== "postgres") throw new Error("Invalid driver");
      return (
        await s.query(
          "SELECT table_name,table_type FROM information_schema.tables WHERE table_schema=$1 ORDER BY table_name LIMIT 500",
          [c.schema],
        )
      ).rows.map((r) => ({
        resource: String(r.table_name),
        kind: r.table_type === "VIEW" ? "view" : "table",
      }));
    },
    connect: async (c) => {
      const lease = await leasePool(pools, JSON.stringify(c));
      try {
        const client = await lease.resource.connect();
        return {
          query: async (text, params) => {
            const r = await client.query(text, params);
            return { rows: r.rows, affected: r.rowCount ?? 0 };
          },
          begin: async () => {
            await client.query("BEGIN");
          },
          commit: async () => {
            await client.query("COMMIT");
          },
          rollback: async () => {
            await client.query("ROLLBACK");
          },
          release: async () => {
            client.release();
            await lease.release();
          },
        };
      } catch (e) {
        await lease.release();
        throw e;
      }
    },
  });
}
