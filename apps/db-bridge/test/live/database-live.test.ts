import { expect, it } from "vitest";
import { Pool } from "pg";
import mysql from "mysql2/promise";
import sql from "mssql";
import { MongoClient, ObjectId, Long, Decimal128 } from "mongodb";
import {
  databaseConnectionSchema,
  databaseMutationSchema,
  databaseReadSchema,
  type DatabaseKind,
} from "@savia/studio-shared/database-sources";
import { createPostgresDatabaseDriver } from "../../src/postgres-driver";
import { createMysqlDriver } from "../../src/mysql-driver";
import { createMssqlDriver } from "../../src/mssql-driver";
import { createMongoDriver } from "../../src/mongodb-driver";
const enabled = process.env.SAVIA_DB_LIVE === "1";
const selected = (
  process.env.SAVIA_DB_ENGINES ?? "postgres,mysql,mssql,mongodb"
).split(",") as DatabaseKind[];
const factories = {
  postgres: createPostgresDatabaseDriver,
  mysql: createMysqlDriver,
  mssql: createMssqlDriver,
  mongodb: createMongoDriver,
};
for (const kind of selected) {
  it.skipIf(!enabled)(
    `${kind}: live discovery, generated IDs, exact values, CRUD and missing records`,
    async () => {
      const resource = `savia_test_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
      const connection = databaseConnectionSchema.parse({
        kind,
        host: "127.0.0.1",
        port: { postgres: 15432, mysql: 13306, mssql: 11433, mongodb: 17017 }[
          kind
        ],
        database: kind === "mssql" ? "tempdb" : "savia_test",
        ...(kind !== "mongodb"
          ? {
              username: { postgres: "postgres", mysql: "root", mssql: "sa" }[
                kind
              ],
              password:
                kind === "mssql" ? "Savia_test_Only_2026" : "savia_test_only",
            }
          : {}),
        ...(kind === "mssql"
          ? { encrypt: false, trustServerCertificate: true }
          : { ssl: false }),
      });
      const driver = factories[kind]();
      let cleanup = async () => {};
      try {
        if (kind === "postgres") {
          const pool = new Pool({
            host: connection.host,
            port: connection.port,
            database: connection.database,
            user: "postgres",
            password: "savia_test_only",
          });
          cleanup = async () => {
            await pool.query(`DROP TABLE IF EXISTS "${resource}"`);
            await pool.end();
          };
          await pool.query(
            `CREATE TABLE "${resource}" (id BIGSERIAL PRIMARY KEY,name TEXT NOT NULL UNIQUE, amount NUMERIC(30,4), large BIGINT, data JSONB)`,
          );
        } else if (kind === "mysql") {
          const client = await mysql.createConnection({
            host: connection.host,
            port: connection.port,
            database: connection.database,
            user: "root",
            password: "savia_test_only",
          });
          cleanup = async () => {
            await client.query(`DROP TABLE IF EXISTS \`${resource}\``);
            await client.end();
          };
          await client.query(
            `CREATE TABLE \`${resource}\` (id BIGINT AUTO_INCREMENT PRIMARY KEY,name VARCHAR(100) NOT NULL UNIQUE,amount DECIMAL(30,4),large BIGINT,data JSON)`,
          );
          await client.query(
            `CREATE UNIQUE INDEX prefix_key ON \`${resource}\` (large,name(10))`,
          );
        } else if (kind === "mssql") {
          const pool = await new sql.ConnectionPool({
            server: connection.host,
            port: connection.port,
            database: connection.database,
            user: "sa",
            password: "Savia_test_Only_2026",
            options: { encrypt: false, trustServerCertificate: true },
          }).connect();
          cleanup = async () => {
            await pool.request().query(`DROP TABLE IF EXISTS [${resource}]`);
            await pool.close();
          };
          await pool
            .request()
            .query(
              `CREATE TABLE [${resource}] (id BIGINT IDENTITY PRIMARY KEY,name NVARCHAR(100) NOT NULL UNIQUE,amount DECIMAL(30,4),large BIGINT,data NVARCHAR(MAX))`,
            );
        } else {
          const client = await new MongoClient(
            `mongodb://127.0.0.1:${connection.port}`,
            { directConnection: true },
          ).connect();
          cleanup = async () => {
            await client.db(connection.database).collection(resource).drop();
            await client.close();
          };
          await client.db(connection.database).createCollection(resource);
          await client
            .db(connection.database)
            .collection(resource)
            .insertOne({
              _id: new ObjectId(),
              name: "Seed",
              large: Long.fromString("1"),
              amount: Decimal128.fromString("1.0000"),
              customer: new ObjectId("507f1f77bcf86cd799439011"),
            });
        }
        await driver.testConnection(connection);
        expect(await driver.listResources(connection)).toContainEqual({
          resource,
          kind: kind === "mongodb" ? "collection" : "table",
        });
        const metadata = await driver.inspect(connection, resource);
        expect(metadata.kind).toBe(kind === "mongodb" ? "collection" : "table");
        if (kind === "mysql")
          expect(metadata.uniqueKeys).not.toContainEqual(["large"]);
        const key = kind === "mongodb" ? "_id" : "id";
        const columns = [
          key,
          "name",
          "amount",
          "large",
          "data",
          ...(kind === "mongodb" ? ["customer"] : []),
        ];
        const common = {
          connection,
          resource,
          columns,
          idColumn: key,
          ...(kind === "mongodb" ? { idType: "objectId" } : {}),
        };
        const values = {
          ...(kind === "mongodb"
            ? { customer: "507f1f77bcf86cd799439011" }
            : {}),
          name: "Acme",
          amount: "12345678901234567890.1234",
          large: "9007199254740993",
          data: kind === "mssql" ? '{"active":true}' : { active: true },
        };
        const created = await driver.mutate(
          databaseMutationSchema.parse({
            ...common,
            operation: "create",
            values,
          }),
        );
        const row = created.data as Record<string, unknown>;
        expect(row.name).toBe("Acme");
        expect(row.large).toBe("9007199254740993");
        expect(row.amount).toBe("12345678901234567890.1234");
        if (kind === "mongodb") {
          expect(
            (await driver.inspect(connection, resource)).fields.find(
              (f) => f.name === "customer",
            )?.nativeType,
          ).toBe("objectId");
          await expect(
            driver.mutate(
              databaseMutationSchema.parse({
                ...common,
                operation: "update",
                id: String(row[key]),
                values: { large: "9223372036854775808" },
              }),
            ),
          ).rejects.toMatchObject({ status: 422 });
        }
        const id = String(row[key]);
        expect(id).not.toBe("undefined");
        const read = await driver.read(
          databaseReadSchema.parse({ ...common, operation: "read", id }),
        );
        expect((read.data as any).name).toBe("Acme");
        const listed = await driver.read(
          databaseReadSchema.parse({
            ...common,
            operation: "list",
            filters: [{ field: "name", op: "eq", value: "Acme" }],
            perPage: 1,
          }),
        );
        expect(listed.data).toHaveLength(1);
        expect(listed.hasNext).toBe(false);
        const updated = await driver.mutate(
          databaseMutationSchema.parse({
            ...common,
            operation: "update",
            id,
            values: { name: "Changed" },
          }),
        );
        expect((updated.data as any).name).toBe("Changed");
        // An unchanged MySQL update is a match, not a missing row.
        expect(
          (
            await driver.mutate(
              databaseMutationSchema.parse({
                ...common,
                operation: "update",
                id,
                values: { name: "Changed" },
              }),
            )
          ).data,
        ).toBeTruthy();
        await driver.mutate(
          databaseMutationSchema.parse({ ...common, operation: "delete", id }),
        );
        await expect(
          driver.read(
            databaseReadSchema.parse({ ...common, operation: "read", id }),
          ),
        ).rejects.toMatchObject({ status: 404 });
        await expect(
          driver.mutate(
            databaseMutationSchema.parse({
              ...common,
              operation: "delete",
              id,
            }),
          ),
        ).rejects.toMatchObject({ status: 404 });
      } finally {
        await driver.close();
        await cleanup();
      }
    },
    60000,
  );
}
