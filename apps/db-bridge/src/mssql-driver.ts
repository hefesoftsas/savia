import sql from "mssql";
import { ConnectionPools, leasePool } from "./connection-pools";
import { createRelationalDriver } from "./relational-driver";
import { fieldType } from "./database-values";
import { DatabaseBridgeError } from "./database-errors";
export function createMssqlDriver() {
  const pools = new ConnectionPools(
    async (key) => {
      const c = JSON.parse(key);
      const pool = new sql.ConnectionPool({
        server: c.host,
        port: c.port,
        database: c.database,
        user: c.username,
        password: c.password,
        options: {
          encrypt: c.encrypt,
          trustServerCertificate: c.trustServerCertificate,
        },
        pool: { max: 5, min: 0, idleTimeoutMillis: 30000 },
        connectionTimeout: 5000,
        requestTimeout: 10000,
      });
      pool.on("error", () => {});
      return pool.connect();
    },
    async (p) => p.close(),
  );
  return createRelationalDriver({
    kind: "mssql",
    close: () => pools.close(),
    connect: async (c) => {
      const lease = await leasePool(pools, JSON.stringify(c));
      let transaction: sql.Transaction | undefined;
      return {
        query: async (text, params = []) => {
          const request = transaction
            ? new sql.Request(transaction)
            : lease.resource.request();
          params.forEach((value, i) => {
            if (typeof value === "boolean")
              request.input(`p${i}`, sql.Bit, value);
            else if (typeof value === "number")
              request.input(
                `p${i}`,
                Number.isInteger(value) ? sql.BigInt : sql.Float,
                value,
              );
            else
              request.input(
                `p${i}`,
                sql.NVarChar(sql.MAX),
                value == null ? null : String(value),
              );
          });
          const r = await request.query(text);
          return {
            rows: r.recordset ?? [],
            affected: r.recordset?.length ?? r.rowsAffected[0] ?? 0,
          };
        },
        begin: async () => {
          transaction = new sql.Transaction(lease.resource);
          await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
        },
        commit: async () => {
          await transaction!.commit();
          transaction = undefined;
        },
        rollback: async () => {
          if (transaction) await transaction.rollback();
          transaction = undefined;
        },
        release: async () => {
          await lease.release();
        },
      };
    },
    list: async (s, c) => {
      if (c.kind !== "mssql") throw new Error("Invalid driver");
      return (
        await s.query(
          "SELECT TOP (500) TABLE_NAME,TABLE_TYPE FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=@p0 ORDER BY TABLE_NAME",
          [c.schema],
        )
      ).rows.map((r) => ({
        resource: String(r.TABLE_NAME),
        kind: r.TABLE_TYPE === "VIEW" ? "view" : "table",
      }));
    },
    inspect: async (s, c, resource) => {
      if (c.kind !== "mssql") throw new Error("Invalid driver");
      const columns = await s.query(
        `SELECT c.name,t.name AS native_type,c.is_nullable,c.is_identity,c.is_computed,c.default_object_id,o.type FROM sys.columns c JOIN sys.types t ON c.user_type_id=t.user_type_id JOIN sys.objects o ON c.object_id=o.object_id JOIN sys.schemas s ON o.schema_id=s.schema_id WHERE s.name=@p0 AND o.name=@p1 AND o.type IN ('U','V') ORDER BY c.column_id`,
        [c.schema, resource],
      );
      if (!columns.rows.length)
        throw new DatabaseBridgeError(
          "DATABASE_NOT_FOUND",
          "Resource not found.",
          404,
        );
      const keys = await s.query(
        `SELECT i.name,i.is_primary_key,c.name AS column_name FROM sys.indexes i JOIN sys.index_columns ic ON i.object_id=ic.object_id AND i.index_id=ic.index_id JOIN sys.columns c ON c.object_id=ic.object_id AND c.column_id=ic.column_id JOIN sys.objects o ON o.object_id=i.object_id JOIN sys.schemas s ON s.schema_id=o.schema_id WHERE s.name=@p0 AND o.name=@p1 AND i.is_unique=1 AND i.has_filter=0 AND i.is_disabled=0 AND ic.is_included_column=0 ORDER BY i.name,ic.key_ordinal`,
        [c.schema, resource],
      );
      const groups = new Map<string, { primary: boolean; columns: string[] }>();
      for (const r of keys.rows) {
        const key = String(r.name);
        const group = groups.get(key) ?? {
          primary: Boolean(r.is_primary_key),
          columns: [],
        };
        group.columns.push(String(r.column_name));
        groups.set(key, group);
      }
      return {
        resource,
        kind: columns.rows[0]?.type === "V" ? "view" : "table",
        sampled: false,
        primaryKey: [...groups.values()].find((g) => g.primary)?.columns ?? [],
        uniqueKeys: [...groups.values()]
          .filter((g) => !g.primary)
          .map((g) => g.columns),
        fields: columns.rows.map((r) => {
          const type = fieldType(String(r.native_type));
          const generated =
            Boolean(r.is_identity || r.is_computed) ||
            ["timestamp", "rowversion"].includes(String(r.native_type));
          return {
            name: String(r.name),
            nativeType: String(r.native_type),
            valueType: type,
            nullable: Boolean(r.is_nullable),
            generated,
            writable: !generated && !["binary", "unsupported"].includes(type),
            hasDefault: Number(r.default_object_id) > 0 || generated,
          };
        }),
      };
    },
  });
}
