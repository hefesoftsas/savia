import mysql, {
  type RowDataPacket,
  type ResultSetHeader,
} from "mysql2/promise";
import { ConnectionPools, leasePool } from "./connection-pools";
import { createRelationalDriver } from "./relational-driver";
import { fieldType } from "./database-values";
import { DatabaseBridgeError } from "./database-errors";
export function mysqlUniqueKeys(rows: Record<string, unknown>[]) {
  const groups = new Map<string, string[]>();
  const unsupported = new Set<string>();
  for (const row of rows) {
    const name = String(row.INDEX_NAME);
    if (row.SUB_PART != null || row.COLUMN_NAME == null) unsupported.add(name);
    groups.set(name, [...(groups.get(name) ?? []), String(row.COLUMN_NAME)]);
  }
  for (const name of unsupported) groups.delete(name);
  return groups;
}
export function createMysqlDriver() {
  const pools = new ConnectionPools(
    async (key) => {
      const c = JSON.parse(key);
      return mysql.createPool({
        host: c.host,
        port: c.port,
        database: c.database,
        user: c.username,
        password: c.password,
        ssl: c.ssl ? { rejectUnauthorized: true } : undefined,
        supportBigNumbers: true,
        bigNumberStrings: true,
        dateStrings: true,
        connectionLimit: 5,
        connectTimeout: 5000,
        multipleStatements: false,
        waitForConnections: false,
      });
    },
    async (p) => p.end(),
  );
  return createRelationalDriver({
    kind: "mysql",
    close: () => pools.close(),
    connect: async (c) => {
      const lease = await leasePool(pools, JSON.stringify(c));
      try {
        const client = await lease.resource.getConnection();
        return {
          query: async (text, params) => {
            const [raw] = await client.query(
              { sql: text, timeout: 10000 },
              params,
            );
            return Array.isArray(raw)
              ? { rows: raw as RowDataPacket[], affected: raw.length }
              : { rows: [], affected: (raw as ResultSetHeader).affectedRows };
          },
          begin: () => client.beginTransaction(),
          commit: () => client.commit(),
          rollback: () => client.rollback(),
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
    list: async (s, c) =>
      (
        await s.query(
          "SELECT TABLE_NAME, TABLE_TYPE FROM information_schema.TABLES WHERE TABLE_SCHEMA=? ORDER BY TABLE_NAME LIMIT 500",
          [c.database],
        )
      ).rows.map((r) => ({
        resource: String(r.TABLE_NAME),
        kind: r.TABLE_TYPE === "VIEW" ? "view" : "table",
      })),
    inspect: async (s, c, resource) => {
      const columns = await s.query(
        "SELECT c.COLUMN_NAME,c.DATA_TYPE,c.IS_NULLABLE,c.COLUMN_DEFAULT,c.EXTRA,t.TABLE_TYPE FROM information_schema.COLUMNS c JOIN information_schema.TABLES t ON t.TABLE_SCHEMA=c.TABLE_SCHEMA AND t.TABLE_NAME=c.TABLE_NAME WHERE c.TABLE_SCHEMA=? AND c.TABLE_NAME=? ORDER BY c.ORDINAL_POSITION",
        [c.database, resource],
      );
      if (!columns.rows.length)
        throw new DatabaseBridgeError(
          "DATABASE_NOT_FOUND",
          "Resource not found.",
          404,
        );
      const keys = await s.query(
        "SELECT INDEX_NAME,COLUMN_NAME,SUB_PART FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND NON_UNIQUE=0 ORDER BY INDEX_NAME,SEQ_IN_INDEX",
        [c.database, resource],
      );
      const groups = mysqlUniqueKeys(keys.rows);
      return {
        resource,
        kind: columns.rows[0]?.TABLE_TYPE === "VIEW" ? "view" : "table",
        sampled: false,
        primaryKey: groups.get("PRIMARY") ?? [],
        uniqueKeys: [...groups]
          .filter(([k]) => k !== "PRIMARY")
          .map(([, v]) => v),
        fields: columns.rows.map((r) => {
          const type = fieldType(String(r.DATA_TYPE));
          const generated =
            /auto_increment|VIRTUAL GENERATED|STORED GENERATED/i.test(
              String(r.EXTRA),
            );
          return {
            name: String(r.COLUMN_NAME),
            nativeType: String(r.DATA_TYPE),
            valueType: type,
            nullable: r.IS_NULLABLE === "YES",
            generated,
            writable: !generated && !["binary", "unsupported"].includes(type),
            hasDefault: r.COLUMN_DEFAULT != null || generated,
            defaultValue:
              r.COLUMN_DEFAULT == null ? null : String(r.COLUMN_DEFAULT),
          };
        }),
      };
    },
  });
}
