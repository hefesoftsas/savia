import { createPostgresPool, closePostgresPool } from "../src/postgres/pool";
import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import pg from "pg";
import { migratePostgres } from "../src/postgres/migrations.js";
const url = process.env.SAVIA_TEST_POSTGRES_URL;
const live = url ? describe : describe.skip;
// Native fixtures create hundreds of tables/indexes; concurrent image builds can delay DDL.
const nativeDdlTimeout = 120_000;
live("PostgreSQL native migrations", () => {
  it("serializes initialization, verifies history and rolls back invalid migrations", async () => {
    const admin = createPostgresPool({ connectionString: url });
    const name = `savia_migration_${randomUUID().replaceAll("-", "")}`;
    const directory = await mkdtemp(join(tmpdir(), "savia-pg-migrations-"));
    let pool: pg.Pool | undefined;
    try {
      await admin.query(`CREATE DATABASE "${name}"`);
      const target = new URL(url!);
      target.pathname = `/${name}`;
      pool = createPostgresPool({ connectionString: target.href });
      const options = {
        connectionString: target.href,
        schema: "savia_core" as const,
        directory,
        seed: true,
      };
      await writeFile(
        join(directory, "0001.sql"),
        "CREATE TABLE example(id INTEGER PRIMARY KEY); INSERT INTO example VALUES (1);",
      );
      const applied = await Promise.all([
        migratePostgres(options),
        migratePostgres(options),
      ]);
      expect(applied.flat()).toEqual(["0001.sql"]);
      expect(
        (await pool.query("SELECT * FROM savia_core.example")).rows,
      ).toEqual([{ id: 1 }]);
      // Branches may add an earlier filename after another migration was applied.
      await writeFile(
        join(directory, "0000.sql"),
        "INSERT INTO example VALUES (2);",
      );
      expect(await migratePostgres(options)).toEqual(["0000.sql"]);
      expect(await migratePostgres(options)).toEqual([]);
      expect(
        (
          await pool.query(
            "SELECT filename FROM savia_core._savia_postgres_migrations ORDER BY position",
          )
        ).rows,
      ).toEqual([{ filename: "0001.sql" }, { filename: "0000.sql" }]);
      await writeFile(
        join(directory, "0002.sql"),
        "CREATE TABLE rolled_back(id INTEGER); SELECT missing_column;",
      );
      await expect(migratePostgres(options)).rejects.toThrow();
      expect(
        (
          await pool.query(
            "SELECT to_regclass('savia_core.rolled_back') AS name",
          )
        ).rows[0].name,
      ).toBeNull();
      await unlink(join(directory, "0002.sql"));
      await writeFile(join(directory, "0001.sql"), "SELECT 1;");
      await expect(migratePostgres(options)).rejects.toThrow(/checksum/i);
      await unlink(join(directory, "0001.sql"));
      await expect(migratePostgres(options)).rejects.toThrow(/missing/i);
    } finally {
      if (pool) await closePostgresPool(pool);
      await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      await closePostgresPool(admin);
      await rm(directory, { recursive: true, force: true });
    }
  });
});
it("rejects unknown schemas before connecting", async () => {
  await expect(
    migratePostgres({
      connectionString: "invalid",
      schema: "public" as "savia_core",
      directory: resolve("missing"),
      seed: true,
    }),
  ).rejects.toThrow(/schema/i);
});

import { readFileSync, readdirSync } from "node:fs";
import { SqliteDatabase } from "../src/sqlite.js";
import {
  withPostgresFixture,
  postgresTestsRequired,
} from "./postgres-fixture.js";
const root = resolve(import.meta.dirname, "../../..");
const coreDirectory = join(root, "packages/db/postgres");
const requestDirectory = join(root, "apps/savia-request/postgres");
if (postgresTestsRequired && !url)
  it("requires the live PostgreSQL URL", () => {
    throw new Error("SAVIA_TEST_POSTGRES_URL is required.");
  });
live("native baseline parity", () => {
  it(
    "covers every source table, column, explicit index and trigger and supports import without seeds",
    async () => {
      await withPostgresFixture(async (db, connectionString) => {
        await migratePostgres({
          connectionString,
          schema: "savia_core",
          directory: coreDirectory,
          seed: false,
        });
        await migratePostgres({
          connectionString,
          schema: "savia_request",
          directory: requestDirectory,
          seed: false,
        });
        const manifest = JSON.parse(
          readFileSync(join(coreDirectory, "manifest.json"), "utf8"),
        );
        const tables = (
          await db
            .prepare(
              "SELECT tablename AS name FROM pg_tables WHERE schemaname='savia_core' AND tablename<>'_savia_postgres_migrations' ORDER BY tablename",
            )
            .all<{ name: string }>()
        ).results;
        expect(tables.map((t) => t.name)).toEqual(
          manifest.tables.map((t: { name: string }) => t.name).sort(),
        );
        const columns = (
          await db
            .prepare(
              "SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='savia_core' ORDER BY table_name,ordinal_position",
            )
            .all<{ table_name: string; column_name: string }>()
        ).results;
        for (const table of manifest.tables)
          expect(
            columns
              .filter((c) => c.table_name === table.name)
              .map((c) => c.column_name),
          ).toEqual(table.columns.map((c: { name: string }) => c.name));
        const indexes = (
          await db
            .prepare(
              "SELECT indexname AS name FROM pg_indexes WHERE schemaname='savia_core'",
            )
            .all<{ name: string }>()
        ).results.map((r) => r.name);
        for (const index of manifest.objects.filter(
          (o: { type: string }) => o.type === "index",
        ))
          expect(indexes).toContain(index.name);
        const constraints = (
          await db
            .prepare(
              "SELECT relname AS name,contype,count(*)::integer AS n FROM pg_constraint JOIN pg_class ON conrelid=pg_class.oid JOIN pg_namespace ON relnamespace=pg_namespace.oid WHERE nspname='savia_core' GROUP BY relname,contype",
            )
            .all<{ name: string; contype: string; n: number }>()
        ).results;
        for (const table of manifest.tables) {
          expect(
            constraints.find((c) => c.name === table.name && c.contype === "f")
              ?.n ?? 0,
          ).toBe(
            new Set(table.foreignKeys.map((fk: { id: number }) => fk.id)).size,
          );
          expect(
            constraints.find((c) => c.name === table.name && c.contype === "c")
              ?.n ?? 0,
          ).toBe(table.checkCount);
        }
        const triggers = (
          await db
            .prepare(
              "SELECT tgname AS name FROM pg_trigger JOIN pg_class ON tgrelid=pg_class.oid JOIN pg_namespace ON relnamespace=pg_namespace.oid WHERE nspname='savia_core' AND NOT tgisinternal",
            )
            .all<{ name: string }>()
        ).results
          .map((r) => r.name)
          .sort();
        expect(triggers).toEqual(
          manifest.objects
            .filter((o: { type: string }) => o.type === "trigger")
            .map((o: { name: string }) => o.name)
            .sort(),
        );
        for (const table of manifest.tables.filter(
          (t: { seedRows: number }) => t.seedRows,
        ))
          expect(
            await db
              .prepare(`SELECT count(*) AS n FROM "${table.name}"`)
              .first("n"),
          ).toBe(0);
        expect(
          await migratePostgres({
            connectionString,
            schema: "savia_core",
            directory: coreDirectory,
            seed: true,
          }),
        ).toEqual([]);
      });
    },
    nativeDdlTimeout,
  );
  it(
    "matches SQLite history, synchronization, rollback, access revocation and tenant removal",
    async () => {
      await withPostgresFixture(async (postgres, connectionString) => {
        const initialization = await Promise.all([
          migratePostgres({
            connectionString,
            schema: "savia_core",
            directory: coreDirectory,
            seed: true,
          }),
          migratePostgres({
            connectionString,
            schema: "savia_core",
            directory: coreDirectory,
            seed: true,
          }),
        ]);
        expect(initialization.flat()).toEqual([
          "0001_baseline.sql",
          "0002_workflow_collection_triggers.sql",
        ]);
        expect(
          await postgres
            .prepare("SELECT count(*) AS n FROM assistant_virtual_employees")
            .first("n"),
        ).toBe(2);
        const sqlite = new SqliteDatabase(":memory:");
        try {
          await sqlite.migrate(join(root, "packages/db/migrations"));
          const snapshots: unknown[] = [];
          for (const db of [sqlite, postgres]) {
            const at = "2026-09-19T00:00:00.000Z";
            await db
              .prepare(
                "INSERT INTO tenants(id,id_slug,name,created_at,updated_at) VALUES(?,?,?,?,?)",
              )
              .bind(999, "parity", "Parity", at, at)
              .run();
            await db
              .prepare(
                "INSERT INTO identity_principal(id,issuer,subject,email,display_name,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
              )
              .bind(
                "principal",
                "test",
                "subject",
                "p@example.test",
                "Principal",
                at,
                at,
              )
              .run();
            await db
              .prepare(
                "INSERT INTO identity_tenant_membership(id,principal_id,tenant_id,role,created_at,updated_at) VALUES(?,?,?,?,?,?)",
              )
              .bind("member", "principal", 999, "operator", at, at)
              .run();
            const config = JSON.stringify({
              fields: {
                name: { type: "Textbox" },
                number: { type: "Number" },
                secret: { type: "Textbox", config: { sensitive: true } },
              },
              studio: {
                history: {
                  enabled: true,
                  fields: ["name", "number", "secret"],
                  retentionDays: 30,
                },
              },
            });
            await db
              .prepare(
                "INSERT INTO studio_objects(tenant_id,name,label,config) VALUES(?,?,?,?)",
              )
              .bind("agency:999", "items", "Items", config)
              .run();
            await db
              .prepare(
                "INSERT INTO studio_records(tenant_id,object_name,id,data,created_at,updated_at) VALUES(?,?,?,?,?,?)",
              )
              .bind(
                "agency:999",
                "items",
                "record",
                JSON.stringify({
                  name: "Before",
                  number: 0,
                  secret: "redacted",
                }),
                at,
                at,
              )
              .run();
            await db
              .prepare(
                "UPDATE studio_records SET data=?,version=version+1 WHERE id=?",
              )
              .bind(
                JSON.stringify({
                  name: "After",
                  number: false,
                  secret: "redacted2",
                }),
                "record",
              )
              .run();
            await db
              .prepare(
                "UPDATE studio_records SET deleted_at=?,version=version+1 WHERE id=?",
              )
              .bind(at, "record")
              .run();
            await db
              .prepare(
                "UPDATE studio_records SET deleted_at=NULL,version=version+1 WHERE id=?",
              )
              .bind("record")
              .run();
            await expect(
              db.batch([
                db
                  .prepare(
                    "UPDATE studio_records SET data=?,version=version+1 WHERE id=?",
                  )
                  .bind('{"name":"rollback"}', "record"),
                db
                  .prepare(
                    "INSERT INTO tenants(id,id_slug,name,created_at,updated_at) VALUES(?,?,?,?,?)",
                  )
                  .bind(999, "duplicate", "Duplicate", at, at),
              ]),
            ).rejects.toThrow();
            const history = (
              await db
                .prepare(
                  "SELECT version,action,actor_kind,changes FROM studio_record_history ORDER BY version",
                )
                .all<{
                  version: number;
                  action: string;
                  actor_kind: string;
                  changes: string;
                }>()
            ).results.map((row) => ({
              ...row,
              changes: JSON.parse(row.changes),
            }));
            expect(history).toHaveLength(4);
            const sync = await db
              .prepare(
                "SELECT version,data,deleted_at FROM crm_sync_changes WHERE id=?",
              )
              .bind("record")
              .first();
            const revisionBefore = Number(
              await db
                .prepare(
                  "SELECT revision FROM access_revisions WHERE scope='tenant:999'",
                )
                .first("revision"),
            );
            await db
              .prepare(
                "DELETE FROM identity_tenant_membership WHERE id='member'",
              )
              .run();
            expect(
              await db
                .prepare(
                  "SELECT count(*) AS n FROM access_assignments WHERE principal_id='principal'",
                )
                .first("n"),
            ).toBe(0);
            const revisionAfter = Number(
              await db
                .prepare(
                  "SELECT revision FROM access_revisions WHERE scope='tenant:999'",
                )
                .first("revision"),
            );
            expect(revisionAfter).toBeGreaterThan(revisionBefore);
            await db
              .prepare("DELETE FROM studio_records WHERE id='record'")
              .run();
            const tombstone = await db
              .prepare(
                "SELECT version FROM crm_sync_changes WHERE id='record' AND deleted_at IS NOT NULL",
              )
              .first("version");
            expect(tombstone).toBe(5);
            expect(
              await db
                .prepare("SELECT count(*) AS n FROM studio_record_history")
                .first("n"),
            ).toBe(0);
            await db.prepare("DELETE FROM tenants WHERE id=999").run();
            expect(
              await db
                .prepare(
                  "SELECT count(*) AS n FROM access_roles WHERE scope='tenant:999'",
                )
                .first("n"),
            ).toBe(0);
            snapshots.push({
              history,
              sync,
              revisionBefore,
              revisionAfter,
              tombstone,
              finalRevision: await db
                .prepare(
                  "SELECT revision FROM access_revisions WHERE scope='tenant:999'",
                )
                .first("revision"),
            });
          }
          expect(snapshots[1]).toEqual(snapshots[0]);
        } finally {
          sqlite.close();
        }
      });
    },
    nativeDdlTimeout,
  );
});

it("pins every source migration checksum for both native baselines", () => {
  for (const directory of [coreDirectory, requestDirectory]) {
    const manifest = JSON.parse(
      readFileSync(join(directory, "manifest.json"), "utf8"),
    );
    expect(
      manifest.sourceMigrations.map(
        (source: { filename: string }) => source.filename,
      ),
    ).toEqual(
      readdirSync(join(directory, "../migrations"))
        .filter((file) => file.endsWith(".sql"))
        .sort(),
    );
    for (const source of manifest.sourceMigrations)
      expect(
        createHash("sha256")
          .update(
            readFileSync(join(directory, "../migrations", source.filename)),
          )
          .digest("hex"),
      ).toBe(source.sha256);
  }
});

live("native trigger behavior", () => {
  it(
    "matches workflow dispatch and rejects conflicting relation mappings",
    async () => {
      await withPostgresFixture(async (postgres, connectionString) => {
        await migratePostgres({
          connectionString,
          schema: "savia_core",
          directory: coreDirectory,
          seed: true,
        });
        const sqlite = new SqliteDatabase(":memory:");
        try {
          await sqlite.migrate(join(root, "packages/db/migrations"));
          const results: unknown[] = [];
          for (const db of [sqlite, postgres]) {
            await db
              .prepare(
                "INSERT INTO studio_objects(tenant_id,name,label,config) VALUES('scope','items','Items','{}')",
              )
              .run();
            for (const kind of ["created", "updated"]) {
              const definition = JSON.stringify({
                trigger: {
                  type: kind,
                  collection: "items",
                  changedFields: ["title"],
                },
                nodes: [{ id: "first" }],
              });
              await db
                .prepare(
                  "INSERT INTO workflows(workspace_id,id,name,definition,enabled,published_version,created_by) VALUES(?,?,?,?,?,?,?)",
                )
                .bind("scope", kind, kind, definition, 1, kind, "owner")
                .run();
              await db
                .prepare(
                  "INSERT INTO workflow_versions(workspace_id,id,workflow_id,definition,owner_id,revision) VALUES(?,?,?,?,?,?)",
                )
                .bind("scope", kind, kind, definition, "owner", 1)
                .run();
            }
            await db
              .prepare(
                "INSERT INTO studio_records(tenant_id,object_name,id,data) VALUES('scope','items','record','{\"title\":\"First\"}')",
              )
              .run();
            await db
              .prepare(
                "UPDATE studio_records SET data='{\"title\":\"Second\"}',version=version+1 WHERE id='record'",
              )
              .run();
            await db
              .prepare(
                'UPDATE studio_records SET data=\'{"title":"Second","other":1}\',version=version+1 WHERE id=\'record\'',
              )
              .run();
            await db
              .prepare(
                "UPDATE studio_records SET data='{\"title\":false}',version=version+1 WHERE id='record'",
              )
              .run();
            await db
              .prepare(
                "UPDATE studio_records SET data='{\"title\":0}',version=version+1 WHERE id='record'",
              )
              .run();
            expect(
              await db
                .prepare("SELECT count(*) AS n FROM workflow_events")
                .first("n"),
            ).toBe(5);
            results.push(
              (
                await db
                  .prepare(
                    "SELECT workflow_id,node_id,status,depth FROM workflow_executions ORDER BY workflow_id",
                  )
                  .all()
              ).results,
            );
            await db
              .prepare(
                "INSERT INTO studio_collection_relations(tenant_id,id,source_object,target_object,source_label,target_label,cardinality) VALUES('scope','relation','items','items','Source','Target','one-to-one')",
              )
              .run();
            await db
              .prepare(
                "INSERT INTO studio_record_links VALUES('scope','relation','source','target')",
              )
              .run();
            await expect(
              db
                .prepare(
                  "INSERT INTO studio_record_links VALUES('scope','relation','source','other')",
                )
                .run(),
            ).rejects.toThrow("relation_cardinality_conflict");
            await expect(
              db
                .prepare(
                  "UPDATE studio_collection_relations SET storage='fields' WHERE id='relation'",
                )
                .run(),
            ).rejects.toThrow("relation_mapping_has_links");
            await db.prepare("DELETE FROM studio_record_links").run();
            await db
              .prepare(
                "UPDATE studio_collection_relations SET storage='fields' WHERE id='relation'",
              )
              .run();
            await expect(
              db
                .prepare(
                  "INSERT INTO studio_record_links VALUES('scope','relation','source','target')",
                )
                .run(),
            ).rejects.toThrow("relation_mapping_has_links");
          }
          expect(results[1]).toEqual(results[0]);
          expect(results[1]).toHaveLength(4);
        } finally {
          sqlite.close();
        }
      });
    },
    nativeDdlTimeout,
  );
});

live("access revision invalidation", () => {
  it(
    "preserves revision tombstones across membership changes and cascading tenant deletion",
    async () => {
      await withPostgresFixture(async (postgres, connectionString) => {
        await migratePostgres({
          connectionString,
          schema: "savia_core",
          directory: coreDirectory,
          seed: true,
        });
        const sqlite = new SqliteDatabase(":memory:");
        try {
          await sqlite.migrate(join(root, "packages/db/migrations"));
          const results: unknown[] = [];
          for (const db of [sqlite, postgres]) {
            const stages: unknown[] = [];
            const capture = async () =>
              stages.push(
                (
                  await db
                    .prepare(
                      "SELECT scope,revision FROM access_revisions ORDER BY scope",
                    )
                    .all()
                ).results,
              );
            await db
              .prepare(
                "INSERT INTO tenants(id,id_slug,name,created_at,updated_at) VALUES(20,'twenty','Twenty','now','now')",
              )
              .run();
            await db
              .prepare(
                "INSERT INTO tenants(id,id_slug,name,created_at,updated_at) VALUES(21,'twenty-one','Twenty one','now','now')",
              )
              .run();
            await db
              .prepare(
                "INSERT INTO identity_principal(id,issuer,subject,email,display_name,created_at,updated_at) VALUES('p','test','p','p@example.test','P','now','now')",
              )
              .run();
            await db
              .prepare(
                "INSERT INTO identity_tenant_membership(id,principal_id,tenant_id,role,created_at,updated_at) VALUES('m','p',20,'operator','now','now')",
              )
              .run();
            await capture();
            await db
              .prepare(
                "UPDATE identity_tenant_membership SET role='viewer',is_active=0 WHERE id='m'",
              )
              .run();
            await capture();
            await db
              .prepare(
                "UPDATE identity_tenant_membership SET tenant_id=21,is_active=1 WHERE id='m'",
              )
              .run();
            await capture();
            await db
              .prepare("UPDATE identity_principal SET is_active=0 WHERE id='p'")
              .run();
            await capture();
            await db
              .prepare(
                "INSERT INTO identity_global_role VALUES('p','platform_admin','now')",
              )
              .run();
            await capture();
            await db
              .prepare(
                "DELETE FROM identity_global_role WHERE principal_id='p'",
              )
              .run();
            await capture();
            await db
              .prepare("UPDATE tenants SET is_active=0 WHERE id=21")
              .run();
            await capture();
            await db
              .prepare(
                "INSERT INTO studio_data_domains(id,label,created_by) VALUES('d','Domain','p')",
              )
              .run();
            await capture();
            await db
              .prepare("DELETE FROM studio_data_domains WHERE id='d'")
              .run();
            await capture();
            await db
              .prepare(
                "INSERT INTO studio_objects(tenant_id,name,label,config) VALUES('agency:21','items','Items','{}')",
              )
              .run();
            await db
              .prepare(
                "UPDATE studio_objects SET config='{}' WHERE tenant_id='agency:21'",
              )
              .run();
            await capture();
            await db
              .prepare("DELETE FROM studio_objects WHERE tenant_id='agency:21'")
              .run();
            await capture();
            await db.prepare("DELETE FROM tenants WHERE id=21").run();
            await capture();
            expect(
              await db
                .prepare(
                  "SELECT count(*) AS n FROM access_assignments WHERE principal_id='p'",
                )
                .first("n"),
            ).toBe(0);
            expect(
              await db
                .prepare(
                  "SELECT count(*) AS n FROM identity_tenant_membership WHERE principal_id='p'",
                )
                .first("n"),
            ).toBe(0);
            results.push(stages);
          }
          expect(results[1]).toEqual(results[0]);
        } finally {
          sqlite.close();
        }
      });
    },
    nativeDdlTimeout,
  );
});

live("concurrent relation guards", () => {
  it.each([
    {
      name: "conflicting link inserts",
      first:
        "INSERT INTO studio_record_links VALUES('scope','relation','source','first')",
      second:
        "INSERT INTO studio_record_links VALUES('scope','relation','source','second')",
      error: "relation_cardinality_conflict",
      links: 1,
      storage: "local",
    },
    {
      name: "link insertion before a storage change",
      first:
        "INSERT INTO studio_record_links VALUES('scope','relation','source','first')",
      second:
        "UPDATE studio_collection_relations SET storage='fields' WHERE tenant_id='scope' AND id='relation'",
      error: "relation_mapping_has_links",
      links: 1,
      storage: "local",
    },
    {
      name: "storage change before a link insertion",
      first:
        "UPDATE studio_collection_relations SET storage='fields' WHERE tenant_id='scope' AND id='relation'",
      second:
        "INSERT INTO studio_record_links VALUES('scope','relation','source','first')",
      error: "relation_mapping_has_links",
      links: 0,
      storage: "fields",
    },
  ])(
    "serializes $name on the parent definition row",
    async ({ first, second, error, links, storage }) => {
      await withPostgresFixture(async (observer, connectionString) => {
        await migratePostgres({
          connectionString,
          schema: "savia_core",
          directory: coreDirectory,
          seed: false,
        });
        await observer
          .prepare(
            "INSERT INTO studio_objects(tenant_id,name,label,config) VALUES('scope','items','Items','{}')",
          )
          .run();
        await observer
          .prepare(
            "INSERT INTO studio_collection_relations(tenant_id,id,source_object,target_object,source_label,target_label,cardinality) VALUES('scope','relation','items','items','Source','Target','one-to-one')",
          )
          .run();
        const writer = new pg.Client({ connectionString });
        const competitor = new pg.Client({ connectionString });
        await writer.connect();
        await competitor.connect();
        try {
          await writer.query(
            "BEGIN; SET LOCAL search_path TO savia_core,pg_catalog",
          );
          await competitor.query(
            "BEGIN; SET LOCAL search_path TO savia_core,pg_catalog",
          );
          const writerPid = (
            await writer.query("SELECT pg_backend_pid() AS pid")
          ).rows[0].pid;
          const competitorPid = (
            await competitor.query("SELECT pg_backend_pid() AS pid")
          ).rows[0].pid;
          await writer.query(first);
          // Capture rejection immediately so a fast failure cannot be unhandled.
          const pending = competitor.query(second).then(
            () => null,
            (failure: Error) => failure,
          );
          await expect
            .poll(
              async () =>
                observer
                  .prepare(
                    "SELECT ?::integer = ANY(pg_blocking_pids(?::integer)) AS blocked",
                  )
                  .bind(writerPid, competitorPid)
                  .first("blocked"),
              { timeout: 2000 },
            )
            .toBe(true);
          await writer.query("COMMIT");
          const failure = await pending;
          expect(failure).toBeInstanceOf(Error);
          expect(failure?.message).toContain(error);
          await competitor.query("ROLLBACK");
          expect(
            await observer
              .prepare("SELECT count(*) AS n FROM studio_record_links")
              .first("n"),
          ).toBe(links);
          expect(
            await observer
              .prepare(
                "SELECT storage FROM studio_collection_relations WHERE tenant_id='scope' AND id='relation'",
              )
              .first("storage"),
          ).toBe(storage);
        } finally {
          await writer.query("ROLLBACK").catch(() => {});
          await competitor.query("ROLLBACK").catch(() => {});
          await Promise.all([writer.end(), competitor.end()]);
        }
      });
    },
    nativeDdlTimeout,
  );
});

live("collection workflow trigger migration", () => {
  it(
    "matches typed filters, combined events, deletion snapshots and rollback",
    async () => {
      await withPostgresFixture(async (postgres, connectionString) => {
        await migratePostgres({
          connectionString,
          schema: "savia_core",
          directory: coreDirectory,
          seed: false,
        });
        const sqlite = new SqliteDatabase(":memory:");
        try {
          await sqlite.migrate(join(root, "packages/db/migrations"));
          const snapshots: unknown[] = [];
          for (const db of [sqlite, postgres]) {
            await db
              .prepare(
                "INSERT INTO studio_objects(tenant_id,name,label,config) VALUES('events','items','Items','{}')",
              )
              .run();
            const triggers = [
              { type: "created_or_updated", changedFields: ["amount"] },
              {
                type: "deleted",
                conditions: [
                  { field: "name", operator: "contains", value: "Alpha" },
                ],
              },
              ...["eq", "neq", "gt", "gte", "lt", "lte"].map((operator) => ({
                type: "created_or_updated",
                conditions: [{ field: "amount", operator, value: 2 }],
              })),
              {
                type: "created_or_updated",
                conditions: [{ field: "flag", operator: "eq", value: false }],
              },
              {
                type: "created_or_updated",
                conditions: [{ field: "flag", operator: "eq", value: 0 }],
              },
              {
                type: "created_or_updated",
                conditions: [{ field: "absent", operator: "neq", value: 0 }],
              },
              {
                type: "created_or_updated",
                conditions: [
                  { field: "absent", operator: "empty", value: null },
                ],
              },
              {
                type: "created_or_updated",
                conditions: [
                  { field: "name", operator: "not_empty", value: null },
                ],
              },
              {
                type: "created_or_updated",
                conditionMode: "any",
                conditions: [
                  { field: "amount", operator: "eq", value: 2 },
                  { field: "name", operator: "eq", value: "Beta" },
                ],
              },
              {
                type: "created_or_updated",
                conditionMode: "all",
                conditions: [
                  { field: "amount", operator: "eq", value: 2 },
                  { field: "name", operator: "eq", value: "Beta" },
                ],
              },
            ];
            for (const [index, trigger] of triggers.entries()) {
              const id = `flow-${index}`;
              const definition = JSON.stringify({
                trigger: { collection: "items", ...trigger },
                nodes: [{ id: "first" }],
              });
              await db
                .prepare(
                  "INSERT INTO workflows(workspace_id,id,name,definition,enabled,published_version,created_by) VALUES('events',?,?,?,1,?,'owner')",
                )
                .bind(id, id, definition, id)
                .run();
              await db
                .prepare(
                  "INSERT INTO workflow_versions(workspace_id,id,workflow_id,definition,owner_id,revision) VALUES('events',?,?,?,'owner',1)",
                )
                .bind(id, id, definition)
                .run();
            }
            const at = "2026-09-19T00:00:00.000Z";
            await db
              .prepare(
                "INSERT INTO studio_records(tenant_id,object_name,id,data,created_at,updated_at) VALUES('events','items','record',?,?,?)",
              )
              .bind('{"name":"Alpha","amount":2,"flag":false}', at, at)
              .run();
            await db
              .prepare(
                "UPDATE studio_records SET data=?,version=version+1 WHERE tenant_id='events' AND id='record'",
              )
              .bind('{"name":"Beta","amount":3,"flag":0}')
              .run();
            await db
              .prepare(
                "UPDATE studio_records SET data=?,version=version+1 WHERE tenant_id='events' AND id='record'",
              )
              .bind('{"name":"Alpha","amount":false,"flag":false}')
              .run();
            await db
              .prepare(
                "UPDATE studio_records SET data=?,version=version+1 WHERE tenant_id='events' AND id='record'",
              )
              .bind('{"name":"Alpha","amount":0,"flag":false}')
              .run();
            await expect(
              db.batch([
                db
                  .prepare(
                    "UPDATE studio_records SET data=?,version=version+1 WHERE tenant_id='events' AND id='record'",
                  )
                  .bind('{"name":"Rollback","amount":99}'),
                db.prepare(
                  "INSERT INTO studio_objects(tenant_id,name,label,config) VALUES('events','items','Duplicate','{}')",
                ),
              ]),
            ).rejects.toThrow();
            await db
              .prepare(
                "UPDATE studio_records SET deleted_at=?,version=version+1 WHERE tenant_id='events' AND id='record'",
              )
              .bind(at)
              .run();
            // Purging an already soft-deleted record must not create another event.
            await db
              .prepare(
                "DELETE FROM studio_records WHERE tenant_id='events' AND id='record'",
              )
              .run();
            await db
              .prepare(
                "INSERT INTO studio_records(tenant_id,object_name,id,data,created_at,updated_at) VALUES('events','items','hard',?,?,?)",
              )
              .bind('{"name":"Alpha","amount":2}', at, at)
              .run();
            await db
              .prepare(
                "DELETE FROM studio_records WHERE tenant_id='events' AND id='hard'",
              )
              .run();
            const executions = (
              await db
                .prepare(
                  "SELECT workflow_id,context FROM workflow_executions WHERE workspace_id='events' ORDER BY workflow_id,id",
                )
                .all<{ workflow_id: string; context: string }>()
            ).results.map((row) => ({
              workflow: row.workflow_id,
              context: JSON.parse(row.context),
            }));
            const deleted = executions.filter(
              (row) => row.workflow === "flow-1",
            );
            expect(deleted).toHaveLength(2);
            expect(
              deleted.every(
                (row) =>
                  row.context.trigger.name === "Alpha" &&
                  row.context.system.eventType === "deleted",
              ),
            ).toBe(true);
            expect(
              executions.filter((row) => row.workflow === "flow-0"),
            ).toHaveLength(5);
            expect(
              executions.filter((row) => row.workflow === "flow-10"),
            ).toHaveLength(0);
            expect(
              await db
                .prepare(
                  "SELECT count(*) AS n FROM workflow_events WHERE workspace_id='events'",
                )
                .first("n"),
            ).toBe(7);
            // Sequence gaps after a rolled-back PostgreSQL insert are intentional.
            snapshots.push(
              executions
                .map((row) => ({
                  workflow: row.workflow,
                  context: {
                    ...row.context,
                    system: { ...row.context.system, event: undefined },
                  },
                }))
                .sort((a, b) =>
                  [
                    a.workflow,
                    a.context.system.eventType,
                    a.context.trigger.id,
                    a.context.trigger._version,
                  ]
                    .join(":")
                    .localeCompare(
                      [
                        b.workflow,
                        b.context.system.eventType,
                        b.context.trigger.id,
                        b.context.trigger._version,
                      ].join(":"),
                    ),
                ),
            );
          }
          expect(snapshots[1]).toEqual(snapshots[0]);
        } finally {
          sqlite.close();
        }
      });
    },
    nativeDdlTimeout,
  );
});

live("concurrent collection events", () => {
  it(
    "keeps dispatch transactional across two simultaneous writers",
    async () => {
      await withPostgresFixture(async (db, connectionString) => {
        await migratePostgres({
          connectionString,
          schema: "savia_core",
          directory: coreDirectory,
          seed: false,
        });
        await db
          .prepare(
            "INSERT INTO studio_objects(tenant_id,name,label,config) VALUES('events','items','Items','{}')",
          )
          .run();
        const definition = JSON.stringify({
          trigger: {
            type: "created_or_updated",
            collection: "items",
            conditions: [{ field: "amount", operator: "gte", value: 2 }],
          },
          nodes: [{ id: "first" }],
        });
        await db
          .prepare(
            "INSERT INTO workflows(workspace_id,id,name,definition,enabled,published_version,created_by) VALUES('events','flow','Flow',?,1,'v','owner')",
          )
          .bind(definition)
          .run();
        await db
          .prepare(
            "INSERT INTO workflow_versions(workspace_id,id,workflow_id,definition,owner_id,revision) VALUES('events','v','flow',?,'owner',1)",
          )
          .bind(definition)
          .run();
        const a = await db.pool.connect(),
          b = await db.pool.connect();
        try {
          await Promise.all([a.query("BEGIN"), b.query("BEGIN")]);
          await Promise.all([
            a.query(
              "INSERT INTO studio_records(tenant_id,object_name,id,data) VALUES('events','items','rolled-back','{\"amount\":2}')",
            ),
            b.query(
              "INSERT INTO studio_records(tenant_id,object_name,id,data) VALUES('events','items','committed','{\"amount\":3}')",
            ),
          ]);
          expect(
            await db
              .prepare("SELECT count(*) AS n FROM workflow_executions")
              .first("n"),
          ).toBe(0);
          await Promise.all([a.query("ROLLBACK"), b.query("COMMIT")]);
          expect(
            await db
              .prepare("SELECT count(*) AS n FROM workflow_events")
              .first("n"),
          ).toBe(1);
          const rows = (
            await db
              .prepare("SELECT context FROM workflow_executions")
              .all<{ context: string }>()
          ).results;
          expect(rows).toHaveLength(1);
          expect(JSON.parse(rows[0].context).trigger).toMatchObject({
            id: "committed",
            amount: 3,
          });
        } finally {
          await a.query("ROLLBACK").catch(() => {});
          await b.query("ROLLBACK").catch(() => {});
          a.release();
          b.release();
        }
      });
    },
    nativeDdlTimeout,
  );
});
