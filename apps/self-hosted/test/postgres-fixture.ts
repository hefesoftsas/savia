import { randomUUID } from "node:crypto";
import pg from "pg";
import {
  openPostgresDatabase,
  type PostgresDatabase,
} from "../src/postgres/database";

export const postgresTestUrl = process.env.SAVIA_TEST_POSTGRES_URL;
export const postgresTestsRequired =
  process.env.SAVIA_POSTGRES_TEST_REQUIRED === "1";

/** The supplied URL must identify a dedicated test server with CREATE DATABASE rights. */
export async function withPostgresFixture<T>(
  run: (db: PostgresDatabase, url: string) => Promise<T>,
): Promise<T> {
  if (!postgresTestUrl)
    throw new Error(
      "SAVIA_TEST_POSTGRES_URL is required for live PostgreSQL tests.",
    );
  const name = `savia_test_${randomUUID().replaceAll("-", "")}`;
  const admin = new pg.Client({ connectionString: postgresTestUrl });
  let created = false;
  let db: PostgresDatabase | undefined;
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
    created = true;
    const url = new URL(postgresTestUrl);
    url.pathname = `/${name}`;
    const setup = new pg.Client({ connectionString: url.toString() });
    await setup.connect();
    try {
      await setup.query(
        "CREATE SCHEMA savia_core; CREATE SCHEMA savia_auth; CREATE SCHEMA savia_request",
      );
    } finally {
      await setup.end();
    }
    db = openPostgresDatabase({
      connectionString: url.toString(),
      schema: "savia_core",
      maxConnections: 4,
    });
    return await run(db, url.toString());
  } finally {
    try {
      await db?.close();
    } finally {
      try {
        if (created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
      } finally {
        await admin.end();
      }
    }
  }
}
