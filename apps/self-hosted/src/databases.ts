import { resolve } from "node:path";
import type { AuthDependencies } from "../../auth/src/index";
import { registerDialect } from "@savia/db/dialect";
import { postgresDialect } from "@savia/db/postgres-dialect";
import { SqliteDatabase } from "./sqlite";
import { openPostgresDatabase } from "./postgres/database";
import {
  migratePostgres,
  withPostgresDeploymentLock,
} from "./postgres/migrations";
import type { Configuration } from "./config";

export interface DatabaseSet {
  core: D1Database;
  auth: D1Database;
  request: D1Database;
  authDatabase: AuthDependencies["database"];
  initialize(authenticate: () => Promise<void>): Promise<void>;
  close(): Promise<void>;
}
export function openDatabases(
  config: Configuration,
  root: string,
): DatabaseSet {
  const opened: Array<{ close(): void | Promise<void> }> = [];
  if (config.database.driver === "postgres") {
    const options = config.database;
    const core = openPostgresDatabase({ ...options, schema: "savia_core" });
    opened.push(core);
    const auth = openPostgresDatabase({ ...options, schema: "savia_auth" });
    opened.push(auth);
    const request = openPostgresDatabase({
      ...options,
      schema: "savia_request",
    });
    opened.push(request);
    for (const db of [core, auth, request])
      registerDialect(db, postgresDialect);
    return {
      core,
      auth,
      request,
      authDatabase: auth.pool,
      initialize: (authenticate) =>
        withPostgresDeploymentLock(options.connectionString, async (client) => {
          await migratePostgres({
            connectionString: options.connectionString,
            schema: "savia_core",
            directory: resolve(root, "packages/db/postgres"),
            seed: true,
            client,
          });
          await migratePostgres({
            connectionString: options.connectionString,
            schema: "savia_request",
            directory: resolve(root, "apps/savia-request/postgres"),
            seed: true,
            client,
          });
          await client.query("CREATE SCHEMA IF NOT EXISTS savia_auth");
          await authenticate();
        }),
      close: async () => {
        await Promise.all(opened.map((db) => db.close()));
      },
    };
  }
  try {
    const core = new SqliteDatabase(
      resolve(config.dataDirectory, "core.sqlite"),
    );
    opened.push(core);
    const auth = new SqliteDatabase(
      resolve(config.dataDirectory, "auth.sqlite"),
    );
    opened.push(auth);
    const request = new SqliteDatabase(
      resolve(config.dataDirectory, "request.sqlite"),
    );
    opened.push(request);
    return {
      core,
      auth,
      request,
      authDatabase: auth,
      initialize: async (authenticate) => {
        await core.migrate(resolve(root, "packages/db/migrations"));
        await request.migrate(resolve(root, "apps/savia-request/migrations"));
        await authenticate();
      },
      close: async () => {
        for (const db of opened) await db.close();
      },
    };
  } catch (error) {
    for (const db of opened) void db.close();
    throw error;
  }
}
