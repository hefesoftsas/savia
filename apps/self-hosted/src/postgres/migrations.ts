import { createPostgresPool, closePostgresPool } from "./pool";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";

/** The same deployment lock also coordinates native authentication initialization and import. */
export const POSTGRES_DEPLOYMENT_LOCK = 1396790857;
export async function withPostgresDeploymentLock<T>(
  connectionString: string,
  run: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  try {
    const parsed = new URL(connectionString);
    if (!["postgres:", "postgresql:"].includes(parsed.protocol))
      throw new Error();
  } catch {
    throw new Error("Invalid PostgreSQL connection configuration.");
  }
  const pool = createPostgresPool({ connectionString, max: 1 });
  try {
    let client: pg.PoolClient;
    try {
      client = await pool.connect();
    } catch {
      throw new Error(
        "Could not connect to PostgreSQL for schema initialization.",
      );
    }
    try {
      await client.query("SELECT pg_advisory_lock($1)", [
        POSTGRES_DEPLOYMENT_LOCK,
      ]);
      return await run(client);
    } finally {
      await client
        .query("SELECT pg_advisory_unlock($1)", [POSTGRES_DEPLOYMENT_LOCK])
        .catch(() => {});
      client.release();
    }
  } finally {
    await closePostgresPool(pool);
  }
}

export async function migratePostgres(options: {
  connectionString: string;
  schema: "savia_core" | "savia_request";
  directory: string;
  seed: boolean;
  /** Caller retains ownership; use withPostgresDeploymentLock to coordinate all stores. */
  client?: pg.PoolClient;
}): Promise<string[]> {
  if (!["savia_core", "savia_request"].includes(options.schema))
    throw new Error("Unsupported migration schema.");
  if (!options.client)
    return withPostgresDeploymentLock(options.connectionString, (client) =>
      migratePostgres({ ...options, client }),
    );
  const files = (await readdir(options.directory))
    .filter((file) => file.endsWith(".sql"))
    .sort();
  const migrations = await Promise.all(
    files.map(async (filename) => {
      const sql = await readFile(join(options.directory, filename), "utf8");
      return {
        filename,
        sql,
        checksum: createHash("sha256").update(sql).digest("hex"),
      };
    }),
  );
  const client = options.client;
  {
    let locked = false;
    try {
      await client.query("SELECT pg_advisory_lock($1)", [
        POSTGRES_DEPLOYMENT_LOCK,
      ]);
      locked = true;
      await client.query("BEGIN");
      await client.query(`CREATE SCHEMA IF NOT EXISTS "${options.schema}"`);
      await client.query(
        `SET LOCAL search_path TO "${options.schema}", pg_catalog`,
      );
      await client.query("SELECT set_config('savia.seed', $1, true)", [
        String(options.seed),
      ]);
      await client.query(`CREATE TABLE IF NOT EXISTS _savia_postgres_migrations (
        position INTEGER PRIMARY KEY, filename TEXT NOT NULL UNIQUE, checksum TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
      const history = await client.query<{
        position: number;
        filename: string;
        checksum: string;
      }>(
        "SELECT position,filename,checksum FROM _savia_postgres_migrations ORDER BY position",
      );
      const available = new Map(
        migrations.map((migration) => [migration.filename, migration]),
      );
      for (const [index, row] of history.rows.entries()) {
        const migration = available.get(row.filename);
        if (!migration || row.position !== index)
          throw new Error(
            `Migration history invalid or file missing: ${row.filename}.`,
          );
        if (row.checksum !== migration.checksum)
          throw new Error(`Migration checksum changed: ${row.filename}.`);
      }
      const completed = new Set(history.rows.map((row) => row.filename));
      const applied: string[] = [];
      for (const migration of migrations) {
        if (completed.has(migration.filename)) continue;
        await client.query(migration.sql);
        await client.query(
          "INSERT INTO _savia_postgres_migrations(position,filename,checksum) VALUES($1,$2,$3)",
          [
            history.rows.length + applied.length,
            migration.filename,
            migration.checksum,
          ],
        );
        applied.push(migration.filename);
      }
      await client.query("COMMIT");
      return applied;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      if (locked)
        await client
          .query("SELECT pg_advisory_unlock($1)", [POSTGRES_DEPLOYMENT_LOCK])
          .catch(() => {});
    }
  }
}
