import { assertPostgresText } from "./text-values";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { initializeAuthSchema } from "../../../auth/src/index";
import { openPostgresDatabase } from "./database";
import { migratePostgres, withPostgresDeploymentLock } from "./migrations";
import { mapSqliteValue, quote, columnDigest } from "./import-mappings";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const stores = [
  { name: "auth", schema: "savia_auth" },
  { name: "core", schema: "savia_core", migrations: "packages/db/postgres" },
  {
    name: "request",
    schema: "savia_request",
    migrations: "apps/savia-request/postgres",
  },
] as const;
const internal = new Set(["_savia_sqlite_migrations", "sqlite_sequence"]);
const hash = (data: Uint8Array | string) =>
  createHash("sha256").update(data).digest("hex");

async function fileHash(path: string): Promise<string> {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest("hex");
}

/** Safe to display: only schema identifiers, never source record values or IDs. */
export class ImportTextCompatibilityError extends Error {
  constructor(schema: string, table: string, column: string) {
    super(`Unsupported PostgreSQL text in ${schema}.${table}.${column}.`);
    this.name = "ImportTextCompatibilityError";
  }
}

/** Offline only: stop all source/destination writers before invoking this command. */
export async function importSqlite(options: {
  sourceDirectory: string;
  destinationUrl: string;
}) {
  const sources: Array<{
    store: (typeof stores)[number];
    db: DatabaseSync;
    path: string;
    checksum: string;
  }> = [];
  try {
    for (const store of stores) {
      const path = resolve(options.sourceDirectory, `${store.name}.sqlite`);
      // A live WAL is ambiguous: demand a clean shutdown/checkpoint before import.
      if (
        await stat(path + "-wal").then(
          (s) => s.size > 0,
          (error: NodeJS.ErrnoException) => {
            if (error.code === "ENOENT") return false;
            throw error;
          },
        )
      )
        throw new Error(
          "Source has an active WAL; stop and checkpoint SQLite first.",
        );
      const checksum = await fileHash(path);
      // A cleanly closed WAL database retains its WAL header. Ordinary read-only
      // opens still try to create -shm on a read-only mount. Immutable mode avoids
      // sidecars and locks; the stopped-source contract, absent WAL, and original
      // file hashes before/after copying are therefore mandatory.
      const sourceUri = pathToFileURL(path);
      sourceUri.searchParams.set("mode", "ro");
      sourceUri.searchParams.set("immutable", "1");
      const db = new DatabaseSync(sourceUri.href, { readOnly: true });
      sources.push({ store, db, path, checksum });
      if ("migrations" in store) {
        const manifest = JSON.parse(
          await readFile(
            resolve(root, store.migrations, "manifest.json"),
            "utf8",
          ),
        ) as { sourceMigrations: Array<{ filename: string; sha256: string }> };
        const history = db
          .prepare("SELECT filename, checksum FROM _savia_sqlite_migrations")
          .all();
        if (
          history.length !== manifest.sourceMigrations.length ||
          manifest.sourceMigrations.some(
            (m) =>
              !history.some(
                (h) => h.filename === m.filename && h.checksum === m.sha256,
              ),
          )
        )
          throw new Error("Unsupported source migration history.");
      }
      if (db.prepare("PRAGMA quick_check").get()?.quick_check !== "ok")
        throw new Error("Source integrity check failed.");
      if (db.prepare("PRAGMA foreign_key_check").get())
        throw new Error("Source foreign key check failed.");
      for (const table of db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
        )
        .all()) {
        const inspect = db.prepare(
          `SELECT * FROM ${quote(String(table.name))}`,
        );
        inspect.setReadBigInts(true);
        for (const row of inspect.iterate()) {
          for (const [column, value] of Object.entries(row)) {
            if (typeof value !== "string") continue;
            try {
              assertPostgresText(value);
            } catch {
              throw new ImportTextCompatibilityError(
                store.schema,
                String(table.name),
                column,
              );
            }
          }
        }
      }
    }
    return await withPostgresDeploymentLock(
      options.destinationUrl,
      async (client) => {
        const existing = await client.query(
          "SELECT table_schema FROM information_schema.tables WHERE table_schema = ANY($1) AND table_type='BASE TABLE'",
          [stores.map((s) => s.schema)],
        );
        if (existing.rowCount)
          throw new Error(
            "Import requires a brand-new destination without existing tables.",
          );
        for (const store of stores)
          if ("migrations" in store)
            await migratePostgres({
              connectionString: options.destinationUrl,
              schema: store.schema,
              directory: resolve(root, store.migrations),
              seed: false,
              client,
            });
        await client.query("CREATE SCHEMA IF NOT EXISTS savia_auth");
        const authDb = openPostgresDatabase({
          connectionString: options.destinationUrl,
          schema: "savia_auth",
          maxConnections: 1,
        });
        try {
          await initializeAuthSchema(
            {
              AUTH_DB: authDb,
              BETTER_AUTH_URL: "http://localhost:8080",
              BETTER_AUTH_SECRET:
                "offline-schema-initialization-only-secret-00000000",
            },
            { database: authDb.pool },
          );
        } finally {
          await authDb.close();
        }
        await client.query("BEGIN");
        try {
          const foreignKeys = await client.query<{
            schema: string;
            table: string;
            name: string;
            deferrable: boolean;
            deferred: boolean;
          }>(
            `SELECT n.nspname AS schema,c.relname AS table,k.conname AS name,k.condeferrable AS deferrable,k.condeferred AS deferred FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE k.contype='f' AND n.nspname=ANY($1)`,
            [stores.map((s) => s.schema)],
          );
          for (const fk of foreignKeys.rows)
            await client.query(
              `ALTER TABLE ${quote(fk.schema)}.${quote(fk.table)} ALTER CONSTRAINT ${quote(fk.name)} DEFERRABLE INITIALLY DEFERRED`,
            );
          await client.query("SET CONSTRAINTS ALL DEFERRED");
          const tables: Array<{
            schema: string;
            table: string;
            sourceRows: number;
            importedRows: number;
          }> = [];
          for (const { store, db } of sources) {
            const sourceTables = db
              .prepare(
                "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
              )
              .all()
              .map((r) => String(r.name))
              .filter((n) => !internal.has(n));
            const target = await client.query<{ table_name: string }>(
              "SELECT table_name FROM information_schema.tables WHERE table_schema=$1 AND table_type='BASE TABLE' AND table_name <> '_savia_postgres_migrations'",
              [store.schema],
            );
            if (
              sourceTables.length !== target.rows.length ||
              sourceTables.some(
                (t) => !target.rows.some((r) => r.table_name === t),
              )
            )
              throw new Error(`Unsupported source tables in ${store.schema}.`);
            for (const table of sourceTables)
              await client.query(
                `ALTER TABLE ${quote(store.schema)}.${quote(table)} DISABLE TRIGGER USER`,
              );
            for (const table of sourceTables) {
              const destination = `${quote(store.schema)}.${quote(table)}`;
              const columns = await client.query<{
                column_name: string;
                data_type: string;
              }>(
                "SELECT column_name,data_type FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 ORDER BY ordinal_position",
                [store.schema, table],
              );
              const sourceColumns = db
                .prepare(`PRAGMA table_info(${quote(table)})`)
                .all()
                .map((c) => c.name);
              if (
                columns.rows.length !== sourceColumns.length ||
                columns.rows.some((c) => !sourceColumns.includes(c.column_name))
              )
                throw new Error(
                  `Unsupported source columns in ${store.schema}.${table}.`,
                );
              const sourceStatement = db.prepare(
                `SELECT * FROM ${quote(table)}`,
              );
              sourceStatement.setReadBigInts(true);
              const names = columns.rows
                .map((c) => quote(c.column_name))
                .join(",");
              const expected: string[] = [];
              for (const row of sourceStatement.iterate()) {
                const values = columns.rows.map((c) =>
                  mapSqliteValue(row[c.column_name], c.data_type),
                );
                expected.push(
                  hash(
                    JSON.stringify(
                      values.map((value, i) =>
                        columnDigest(value, columns.rows[i].data_type),
                      ),
                    ),
                  ),
                );
                await client.query(
                  `INSERT INTO ${destination} (${names}) VALUES (${values.map((_, i) => "$" + (i + 1)).join(",")})`,
                  values,
                );
              }
              const actual: string[] = [];
              await client.query(
                `DECLARE savia_import_verify NO SCROLL CURSOR FOR SELECT ${columns.rows.map((c) => (["json", "jsonb"].includes(c.data_type) ? `${quote(c.column_name)}::text AS ${quote(c.column_name)}` : quote(c.column_name))).join(",")} FROM ${destination}`,
              );
              try {
                while (true) {
                  const page = await client.query(
                    "FETCH FORWARD 1000 FROM savia_import_verify",
                  );
                  for (const row of page.rows)
                    actual.push(
                      hash(
                        JSON.stringify(
                          columns.rows.map((c) =>
                            columnDigest(row[c.column_name], c.data_type),
                          ),
                        ),
                      ),
                    );
                  if (page.rows.length < 1000) break;
                }
              } finally {
                await client.query("CLOSE savia_import_verify");
              }
              actual.sort();
              if (JSON.stringify(expected.sort()) !== JSON.stringify(actual))
                throw new Error(
                  `Imported value verification failed in ${store.schema}.${table}.`,
                );
              tables.push({
                schema: store.schema,
                table,
                sourceRows: expected.length,
                importedRows: actual.length,
              });
              // Restart identities transactionally; setval would survive rollback.
              for (const c of columns.rows) {
                const seq = await client.query<{ sequence: string | null }>(
                  "SELECT pg_get_serial_sequence($1,$2) AS sequence",
                  [destination, c.column_name],
                );
                if (seq.rows[0]?.sequence) {
                  const maximum = await client.query<{ value: string }>(
                    `SELECT COALESCE(MAX(${quote(c.column_name)}),0)::text AS value FROM ${destination}`,
                  );
                  let highWater = BigInt(maximum.rows[0].value);
                  if (
                    db
                      .prepare(
                        "SELECT 1 FROM sqlite_master WHERE name='sqlite_sequence'",
                      )
                      .get()
                  ) {
                    const sequenceStatement = db.prepare(
                      "SELECT seq FROM sqlite_sequence WHERE name=?",
                    );
                    sequenceStatement.setReadBigInts(true);
                    const sequenceRow = sequenceStatement.get(table);
                    if (
                      sequenceRow &&
                      BigInt(String(sequenceRow.seq)) > highWater
                    )
                      highWater = BigInt(String(sequenceRow.seq));
                  }
                  const next = highWater + 1n;
                  const sequence = seq.rows[0].sequence!;
                  await client.query(
                    `ALTER SEQUENCE ${sequence} RESTART WITH ${next > 0n ? next : 1n}`,
                  );
                }
              }
            }
          }
          await client.query("SET CONSTRAINTS ALL IMMEDIATE");
          for (const fk of foreignKeys.rows)
            await client.query(
              `ALTER TABLE ${quote(fk.schema)}.${quote(fk.table)} ALTER CONSTRAINT ${quote(fk.name)} ${fk.deferrable ? "DEFERRABLE INITIALLY " + (fk.deferred ? "DEFERRED" : "IMMEDIATE") : "NOT DEFERRABLE"}`,
            );
          for (const { schema, table } of tables)
            await client.query(
              `ALTER TABLE ${quote(schema)}.${quote(table)} ENABLE TRIGGER USER`,
            );
          for (const source of sources)
            if ((await fileHash(source.path)) !== source.checksum)
              throw new Error("Source changed during import.");
          await client.query("COMMIT");
          return { tables, verified: true as const };
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        }
      },
    );
  } finally {
    for (const source of sources) source.db.close();
  }
}
