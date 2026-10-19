import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  shadowTablesFor,
  isSkippedTable,
  isPlatformTable,
  quoteIdent,
  formatValue,
  buildInsert,
  buildSelectPage,
  isVirtualTableExportError,
  writeDumpHeader,
  dumpTables,
} from "./d1-table-dump.mjs";

describe("pulumi d1 table dump", () => {
  it("knows FTS5 shadow tables", () => {
    assert.ok(shadowTablesFor("search_fts").includes("search_fts_data"));
    assert.ok(shadowTablesFor("search_fts").includes("search_fts_config"));
    assert.equal(isSkippedTable("search_fts", ["search_fts"]), true);
    assert.equal(isSkippedTable("search_fts_data", ["search_fts"]), true);
    assert.equal(isSkippedTable("tenants", ["search_fts"]), false);
    assert.equal(isPlatformTable("_cf_KV"), true);
    assert.equal(isPlatformTable("tenants"), false);
  });

  it("quotes identifiers and formats values", () => {
    assert.equal(quoteIdent('we"ird'), '"we""ird"');
    assert.equal(formatValue(null), "NULL");
    assert.equal(formatValue(42), "42");
    assert.equal(formatValue(true), "1");
    assert.equal(formatValue("o'clock"), "'o''clock'");
    assert.equal(formatValue([0, 255, 16]), "X'00ff10'");
    assert.throws(() => quoteIdent(""));
    assert.throws(() => formatValue(undefined ?? NaN));
  });

  it("builds inserts and paged selects", () => {
    assert.equal(
      buildInsert("tenants", ["id", "name"], { id: 1, name: "a'b" }),
      `INSERT INTO "tenants" ("id","name") VALUES (1,'a''b') ON CONFLICT DO UPDATE SET "id"=excluded."id","name"=excluded."name";`,
    );
    assert.equal(
      buildSelectPage("tenants", ["id"], 200, 400),
      `SELECT "id" FROM "tenants" ORDER BY rowid LIMIT 200 OFFSET 400`,
    );
    assert.throws(() => buildInsert("t", [], {}));
  });

  it("uses update semantics for rows that overlap migration seeds", () => {
    assert.match(
      buildInsert("_savia_migrations", ["id", "name"], { id: 1, name: "a" }),
      /^INSERT INTO .* ON CONFLICT DO UPDATE SET /,
    );
  });

  it("replays seeded roles without cascading away dumped permission children", async () => {
    const { DatabaseSync } = await import("node:sqlite");
    const database = new DatabaseSync(":memory:");
    const migrationPath = fileURLToPath(
      new URL("../../packages/db/migrations/0001_initial.sql", import.meta.url),
    );
    const migration = await readFile(migrationPath, "utf8");
    const chunks = migration.split("--> statement-breakpoint");
    const createTable = (name) => {
      const statement = chunks.find((chunk) =>
        new RegExp(`^\\s*CREATE TABLE ${name}\\s*\\(`, "i").test(chunk),
      );
      assert.ok(statement, `migration defines ${name}`);
      return statement.trim();
    };

    // Use the real access schema declarations. identity_principal's id key is
    // the only part needed to satisfy access_assignments' unrelated FK.
    database.exec("CREATE TABLE identity_principal (id TEXT PRIMARY KEY);");
    database.exec(createTable("access_revisions"));
    database.exec(createTable("access_roles"));
    database.exec(createTable("access_assignments"));
    database.exec(createTable("access_grants"));
    database.exec(
      "INSERT INTO access_revisions(scope, revision) VALUES ('tenant:7', 0);" +
        "INSERT INTO identity_principal(id) VALUES ('user:1');" +
        "INSERT INTO access_roles(id,scope,name,label,protected,legacy_role) VALUES ('role:editor','tenant:7','editor','Seed label',1,'editor');" +
        "INSERT INTO access_assignments(scope,principal_id,role_id) VALUES ('tenant:7','user:1','role:editor');" +
        "INSERT INTO access_grants(id,scope,role_id,resource,action,predicate,fields) VALUES ('grant:1','tenant:7','role:editor','documents','read','{}','[]');",
    );

    // The table dump is alphabetically ordered: both children precede their
    // seeded role parent. This mirrors the restore import after migrations.
    const dump = [
      "PRAGMA defer_foreign_keys = ON;",
      buildInsert("access_assignments", ["scope", "principal_id", "role_id"], {
        scope: "tenant:7",
        principal_id: "user:1",
        role_id: "role:editor",
      }),
      buildInsert(
        "access_grants",
        ["id", "scope", "role_id", "resource", "action", "predicate", "fields"],
        {
          id: "grant:1",
          scope: "tenant:7",
          role_id: "role:editor",
          resource: "documents",
          action: "write",
          predicate: "{}",
          fields: '["title"]',
        },
      ),
      buildInsert(
        "access_roles",
        [
          "id",
          "scope",
          "name",
          "label",
          "description",
          "enabled",
          "protected",
          "legacy_role",
          "created_at",
        ],
        {
          id: "role:editor",
          scope: "tenant:7",
          name: "editor",
          label: "Restored label",
          description: "restored",
          enabled: 1,
          protected: 1,
          legacy_role: "editor",
          created_at: "2026-01-01T00:00:00.000Z",
        },
      ),
    ].join("\n");

    assert.doesNotThrow(() => database.exec(dump));
    assert.deepEqual(
      database
        .prepare("SELECT scope, principal_id, role_id FROM access_assignments")
        .all()
        .map((row) => ({ ...row })),
      [{ scope: "tenant:7", principal_id: "user:1", role_id: "role:editor" }],
    );
    assert.deepEqual(
      database
        .prepare("SELECT id, resource, action, fields FROM access_grants")
        .all()
        .map((row) => ({ ...row })),
      [
        {
          id: "grant:1",
          resource: "documents",
          action: "write",
          fields: '["title"]',
        },
      ],
    );
    assert.deepEqual(
      database
        .prepare("SELECT label, description FROM access_roles")
        .all()
        .map((row) => ({ ...row })),
      [{ label: "Restored label", description: "restored" }],
    );
    database.close();
  });

  it("writes D1-compatible deferred-FK imports without explicit transactions", async () => {
    const { mkdtemp, readFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const file = join(await mkdtemp(join(tmpdir(), "d1-dump-")), "dump.sql");
    await writeDumpHeader(file);
    const sql = await readFile(file, "utf8");
    assert.match(sql, /PRAGMA defer_foreign_keys = ON;/);
    assert.doesNotMatch(sql, /\b(?:BEGIN|COMMIT);/);
  });

  it("refuses table dumps unless writes were explicitly quiesced", async () => {
    const { dumpDatabase } = await import("./d1-table-dump.mjs");
    await assert.rejects(
      dumpDatabase({
        accountId: "account",
        uuid: "database",
        token: "redacted",
        outputFile: "/tmp/backup.sql",
        stack: "preview",
      }),
      /write-quiescence confirmation/,
    );
    await assert.rejects(
      dumpDatabase({
        accountId: "account",
        uuid: "database",
        token: "redacted",
        outputFile: "/tmp/backup.sql",
        stack: "production",
        quiescent: true,
      }),
      /UUID|accountId/i,
    );
  });

  it("round-trips retired tables with schema, duplicate rows, NULLs, and blobs", async () => {
    const { DatabaseSync } = await import("node:sqlite");
    const { mkdtemp, readFile, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const root = await mkdtemp(join(tmpdir(), "retired-d1-table-"));
    const outputFile = join(root, "dump.sql");
    const source = new DatabaseSync(":memory:");
    source.exec(`
      CREATE TABLE live_parent (id INTEGER PRIMARY KEY);
      INSERT INTO live_parent VALUES (1);
      CREATE TABLE d1_migrations (name TEXT PRIMARY KEY);
      INSERT INTO d1_migrations VALUES ('0001_initial.sql');
      CREATE TABLE _savia_retired_20260930_agencies (
        name TEXT,
        nullable_value TEXT,
        payload BLOB
      );
      INSERT INTO _savia_retired_20260930_agencies VALUES
        ('same', NULL, X'00ff10'),
        ('same', NULL, X'00ff10');
      CREATE TABLE _savia_retired_20260930_agency_types (
        id INTEGER PRIMARY KEY
      );
      INSERT INTO _savia_retired_20260930_agency_types VALUES (1);
      CREATE INDEX retired_agencies_name_idx
        ON _savia_retired_20260930_agencies(name);
      CREATE TABLE live_child (
        parent_id INTEGER REFERENCES _savia_retired_20260930_agency_types(id)
          DEFERRABLE INITIALLY DEFERRED
      );
      INSERT INTO live_child VALUES (1);
      CREATE TRIGGER retired_agencies_audit
        AFTER INSERT ON _savia_retired_20260930_agencies
        BEGIN INSERT INTO retired_audit(value) VALUES (new.name); END;
      CREATE TABLE retired_audit (value TEXT);
      CREATE VIEW retired_agencies_view AS
        SELECT name, nullable_value FROM _savia_retired_20260930_agencies;
    `);
    try {
      const summary = await dumpTables({
        outputFile,
        batchSize: 20,
        query: async (sql) => ({
          results: source
            .prepare(sql)
            .all()
            .map((row) =>
              Object.fromEntries(
                Object.entries(row).map(([key, value]) => [
                  key,
                  value instanceof Uint8Array ? [...value] : value,
                ]),
              ),
            ),
        }),
      });
      assert.equal(summary.rows, 6);
      const dump = await readFile(outputFile, "utf8");
      const createIndex = dump.indexOf(
        "CREATE INDEX retired_agencies_name_idx",
      );
      const firstInsert = dump.indexOf("INSERT INTO");
      assert.ok(
        createIndex > firstInsert,
        "archive indexes are created after row replay",
      );
      assert.match(dump, /CREATE TABLE _savia_retired_20260930_agencies/);
      assert.match(dump, /CREATE TRIGGER retired_agencies_audit/);
      assert.match(dump, /CREATE VIEW retired_agencies_view/);
      assert.ok(
        dump.indexOf("CREATE TABLE _savia_retired_20260930_agencies") <
          firstInsert,
        "archive tables are created before any row replay",
      );

      const restored = new DatabaseSync(":memory:");
      restored.exec(`
        CREATE TABLE live_parent (id INTEGER PRIMARY KEY);
        INSERT INTO live_parent VALUES (1);
        CREATE TABLE live_child (
          parent_id INTEGER REFERENCES _savia_retired_20260930_agency_types(id)
            DEFERRABLE INITIALLY DEFERRED
        );
        CREATE TABLE retired_audit (value TEXT);
      `);
      assert.doesNotThrow(() => restored.exec(dump));
      assert.equal(
        restored
          .prepare(
            "SELECT count(*) AS count FROM _savia_retired_20260930_agencies",
          )
          .get().count,
        2,
      );
      assert.deepEqual(
        restored
          .prepare("SELECT name FROM d1_migrations")
          .all()
          .map((row) => row.name),
        ["0001_initial.sql"],
      );
      assert.equal(
        restored
          .prepare(
            "SELECT nullable_value FROM _savia_retired_20260930_agencies LIMIT 1",
          )
          .get().nullable_value,
        null,
      );
      assert.deepEqual(
        [
          ...restored
            .prepare(
              "SELECT payload FROM _savia_retired_20260930_agencies LIMIT 1",
            )
            .get().payload,
        ],
        [0, 255, 16],
      );
      assert.equal(
        restored.prepare("SELECT count(*) AS count FROM retired_audit").get()
          .count,
        0,
        "archive triggers must not mutate captured data during replay",
      );
      assert.equal(
        restored.prepare("PRAGMA foreign_key_check").all().length,
        0,
      );
      restored
        .prepare(
          "INSERT INTO _savia_retired_20260930_agencies VALUES (?, ?, ?)",
        )
        .run("later", null, Buffer.from([9]));
      assert.equal(
        restored.prepare("SELECT count(*) AS count FROM retired_audit").get()
          .count,
        1,
      );
      assert.equal(
        restored
          .prepare("SELECT count(*) AS count FROM retired_agencies_view")
          .get().count,
        3,
      );
      assert.equal(
        restored
          .prepare("SELECT count(*) AS count FROM sqlite_master WHERE name = ?")
          .get("retired_agencies_name_idx").count,
        1,
      );
      restored.close();
    } finally {
      source.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("refuses to recreate an existing retired table before replaying its rows", async () => {
    const { DatabaseSync } = await import("node:sqlite");
    const { mkdtemp, readFile, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const root = await mkdtemp(join(tmpdir(), "retired-d1-existing-"));
    const outputFile = join(root, "dump.sql");
    const source = new DatabaseSync(":memory:");
    source.exec(
      "CREATE TABLE _savia_retired_20260930_agencies (value TEXT); INSERT INTO _savia_retired_20260930_agencies VALUES ('backup');",
    );
    try {
      await dumpTables({
        outputFile,
        batchSize: 20,
        query: async (sql) => ({
          results: source
            .prepare(sql)
            .all()
            .map((row) => ({ ...row })),
        }),
      });
      const restored = new DatabaseSync(":memory:");
      restored.exec(
        "CREATE TABLE _savia_retired_20260930_agencies (value TEXT); INSERT INTO _savia_retired_20260930_agencies VALUES ('existing');",
      );
      const dump = await readFile(outputFile, "utf8");
      assert.throws(() => restored.exec(dump));
      assert.deepEqual(
        restored
          .prepare("SELECT value FROM _savia_retired_20260930_agencies")
          .all()
          .map((row) => row.value),
        ["existing"],
      );
      restored.close();
    } finally {
      source.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("marks retired table row-count drift as a retryable consistency error", async () => {
    const { mkdtemp, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const root = await mkdtemp(join(tmpdir(), "retired-d1-count-drift-"));
    try {
      await assert.rejects(
        dumpTables({
          outputFile: join(root, "dump.sql"),
          batchSize: 20,
          query: async (sql) => {
            if (sql.includes("type='table'")) {
              return {
                results: [{ name: "_savia_retired_20260930_agencies" }],
              };
            }
            if (sql.includes("LIKE '%USING fts5%'")) return { results: [] };
            if (sql.startsWith("SELECT sql FROM sqlite_master")) {
              return {
                results: [{ sql: "CREATE TABLE retired (value TEXT)" }],
              };
            }
            if (sql.startsWith("SELECT type, name, sql, tbl_name")) {
              return { results: [] };
            }
            if (sql.startsWith("PRAGMA table_info")) {
              return { results: [{ name: "value" }] };
            }
            if (sql.startsWith("SELECT COUNT(*)")) {
              return { results: [{ c: 2 }] };
            }
            if (sql.startsWith('SELECT "value"')) {
              return { results: [{ value: "one" }] };
            }
            return { results: [] };
          },
        }),
        (error) =>
          error.code === "RECOVERY_CONSISTENCY_DRIFT" &&
          /row count changed while dumping/i.test(error.message),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("refuses virtual archived tables because their schema cannot be replayed", async () => {
    const { DatabaseSync } = await import("node:sqlite");
    const { mkdtemp, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const root = await mkdtemp(join(tmpdir(), "retired-d1-virtual-"));
    const database = new DatabaseSync(":memory:");
    database.exec(
      "CREATE VIRTUAL TABLE _savia_retired_20260930_search USING fts5(value)",
    );
    try {
      await assert.rejects(
        dumpTables({
          outputFile: join(root, "dump.sql"),
          batchSize: 20,
          query: async (sql) => ({ results: database.prepare(sql).all() }),
        }),
        /cannot be safely recreated from a plain CREATE TABLE/i,
      );
    } finally {
      database.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("restores the exact source schema without migration seed collisions", async () => {
    const { DatabaseSync } = await import("node:sqlite");
    const { mkdtemp, readFile, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const root = await mkdtemp(join(tmpdir(), "schema-dump-roundtrip-"));
    const outputFile = join(root, "dump.sql");
    const source = new DatabaseSync(":memory:");
    source.exec(`
      CREATE TABLE access_roles (
        id TEXT PRIMARY KEY,
        scope TEXT NOT NULL,
        name TEXT NOT NULL,
        label TEXT NOT NULL,
        UNIQUE (scope, name)
      );
      INSERT INTO access_roles VALUES
        ('production:role:administrator', 'tenant:production', 'administrator', 'Production label');
      CREATE TABLE role_audit (role_id TEXT, label TEXT);
      CREATE TRIGGER access_roles_audit
        AFTER INSERT ON access_roles
        BEGIN INSERT INTO role_audit VALUES (new.id, new.label); END;
      CREATE VIEW production_roles AS
        SELECT id, scope, name, label FROM access_roles;
      CREATE TABLE generated_ids (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        value TEXT NOT NULL
      );
      INSERT INTO generated_ids(value) VALUES ('kept');
      INSERT INTO generated_ids(value) VALUES ('deleted');
      DELETE FROM generated_ids WHERE value = 'deleted';
      CREATE TABLE studio_record_search (
        id INTEGER PRIMARY KEY,
        body TEXT NOT NULL
      );
      CREATE VIRTUAL TABLE studio_record_search_fts USING fts5(
        body,
        content='studio_record_search',
        content_rowid='id'
      );
      INSERT INTO studio_record_search VALUES (1, 'searchable production record');
      INSERT INTO studio_record_search_fts(studio_record_search_fts) VALUES ('rebuild');
      CREATE INDEX studio_record_search_body_idx ON studio_record_search(body);
    `);
    try {
      const catalogQueries = [];
      const perTableDdlQueries = [];
      const summary = await dumpTables({
        outputFile,
        batchSize: 20,
        schemaDump: true,
        query: async (sql) => ({
          results: (() => {
            if (
              /^\s*SELECT name, sql FROM sqlite_master WHERE type = 'table'/i.test(
                sql,
              )
            )
              catalogQueries.push(sql);
            if (
              /^\s*SELECT sql FROM sqlite_master WHERE (?:type = 'table' AND )?name =/i.test(
                sql,
              )
            )
              perTableDdlQueries.push(sql);
            return source
              .prepare(sql)
              .all()
              .map((row) =>
                Object.fromEntries(
                  Object.entries(row).map(([key, value]) => [
                    key,
                    value instanceof Uint8Array ? [...value] : value,
                  ]),
                ),
              );
          })(),
        }),
      });
      assert.equal(
        catalogQueries.length,
        1,
        "schema dump reads the source table DDL catalog once and reuses it",
      );
      assert.deepEqual(
        perTableDdlQueries,
        [],
        "schema dump does not issue per-table DDL requests",
      );
      assert.equal(summary.method, "schema-dump");
      assert.equal(summary.rows, 3);
      const dump = await readFile(outputFile, "utf8");
      assert.ok(
        dump.indexOf("CREATE TABLE access_roles") < dump.indexOf("INSERT INTO"),
      );
      assert.ok(
        dump.indexOf("CREATE VIRTUAL TABLE studio_record_search_fts") <
          dump.indexOf("INSERT INTO"),
      );
      assert.ok(
        dump.indexOf("CREATE TRIGGER access_roles_audit") >
          dump.indexOf("INSERT INTO"),
      );
      assert.match(dump, /preserve AUTOINCREMENT sequence values/);
      assert.match(dump, /VALUES \('rebuild'\)/);

      const restored = new DatabaseSync(":memory:");
      restored.exec(dump);
      assert.deepEqual(
        restored
          .prepare("SELECT * FROM access_roles")
          .all()
          .map((row) => ({ ...row })),
        [
          {
            id: "production:role:administrator",
            scope: "tenant:production",
            name: "administrator",
            label: "Production label",
          },
        ],
      );
      assert.equal(
        restored
          .prepare(
            "SELECT count(*) AS count FROM access_roles WHERE id LIKE 'seed:%'",
          )
          .get().count,
        0,
        "no migration bootstrap roles are introduced into the recovered source schema",
      );
      assert.equal(
        source
          .prepare("SELECT sql FROM sqlite_master WHERE name='access_roles'")
          .get().sql,
        restored
          .prepare("SELECT sql FROM sqlite_master WHERE name='access_roles'")
          .get().sql,
      );
      assert.equal(
        restored
          .prepare(
            "SELECT count(*) AS count FROM studio_record_search_fts WHERE studio_record_search_fts MATCH 'searchable'",
          )
          .get().count,
        1,
      );
      assert.equal(
        restored
          .prepare("SELECT seq FROM sqlite_sequence WHERE name='generated_ids'")
          .get().seq,
        2,
      );
      assert.equal(
        restored
          .prepare("INSERT INTO generated_ids(value) VALUES ('next')")
          .run().lastInsertRowid,
        3,
      );
      assert.equal(
        restored.prepare("SELECT count(*) AS count FROM role_audit").get()
          .count,
        0,
        "source triggers are installed only after source rows are imported",
      );
      assert.equal(
        restored.prepare("SELECT * FROM production_roles").all().length,
        1,
      );
      restored.close();
    } finally {
      source.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("refuses virtual schemas outside external-content FTS5", async () => {
    const { DatabaseSync } = await import("node:sqlite");
    const { mkdtemp, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const root = await mkdtemp(join(tmpdir(), "unsupported-schema-dump-"));
    for (const [name, ddl, error] of [
      [
        "contentless-fts",
        "CREATE VIRTUAL TABLE retired_fts USING fts5(value, content='')",
        /not a supported external-content FTS5 table/i,
      ],
      [
        "rtree",
        "CREATE VIRTUAL TABLE spatial_index USING rtree(id, min_x, max_x)",
        /unsupported virtual table spatial_index/i,
      ],
    ]) {
      const database = new DatabaseSync(":memory:");
      database.exec(ddl);
      try {
        await assert.rejects(
          dumpTables({
            outputFile: join(root, `${name}.sql`),
            batchSize: 20,
            schemaDump: true,
            query: async (sql) => ({ results: database.prepare(sql).all() }),
          }),
          error,
        );
      } finally {
        database.close();
      }
    }
    await rm(root, { recursive: true, force: true });
  });

  it("skips the unreadable platform table without capturing its hidden schema", async () => {
    const { DatabaseSync } = await import("node:sqlite");
    const { mkdtemp, readFile, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const root = await mkdtemp(join(tmpdir(), "platform-schema-dump-"));
    const outputFile = join(root, "dump.sql");
    const database = new DatabaseSync(":memory:");
    database.exec(
      "CREATE TABLE _cf_KV (id INTEGER PRIMARY KEY AUTOINCREMENT, secret TEXT); INSERT INTO _cf_KV(secret) VALUES ('hidden'); CREATE TABLE app_data (value TEXT); INSERT INTO app_data VALUES ('kept');",
    );
    try {
      const summary = await dumpTables({
        outputFile,
        batchSize: 20,
        schemaDump: true,
        query: async (sql) => {
          if (sql === 'PRAGMA table_info("_cf_KV")') {
            throw new Error("SQLITE_AUTH: reading platform table denied");
          }
          if (sql.includes("name = '_cf_KV'")) {
            throw new Error("Platform DDL must not be queried");
          }
          return { results: database.prepare(sql).all() };
        },
      });
      assert.ok(
        summary.skipped.includes(
          "_cf_KV (platform table, unreadable by design)",
        ),
      );
      const dump = await readFile(outputFile, "utf8");
      assert.match(dump, /CREATE TABLE app_data/);
      assert.doesNotMatch(dump, /_cf_KV|hidden/);
    } finally {
      database.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not filter user tables that merely resemble SQLite system names", async () => {
    const { DatabaseSync } = await import("node:sqlite");
    const { mkdtemp, readFile, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const root = await mkdtemp(join(tmpdir(), "similar-sqlite-table-"));
    const outputFile = join(root, "dump.sql");
    const database = new DatabaseSync(":memory:");
    database.exec(
      "CREATE TABLE sqlitexdata (id INTEGER PRIMARY KEY); INSERT INTO sqlitexdata VALUES (7); CREATE TABLE sequenced(id INTEGER PRIMARY KEY AUTOINCREMENT);",
    );
    try {
      const summary = await dumpTables({
        outputFile,
        batchSize: 20,
        query: async (sql) => ({ results: database.prepare(sql).all() }),
      });
      assert.deepEqual(summary.tables, 2);
      const dump = await readFile(outputFile, "utf8");
      assert.match(dump, /-- table sqlitexdata \(1 rows\)/);
      assert.doesNotMatch(dump, /-- table sqlite_sequence/);
    } finally {
      database.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("round-trips production FTS data only with unchanged live bookmarks", async () => {
    const { DatabaseSync } = await import("node:sqlite");
    const { mkdtemp, access } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { dumpDatabase } = await import("./d1-table-dump.mjs");
    const source = new DatabaseSync(":memory:");
    source.exec(
      "CREATE TABLE documents(id INTEGER PRIMARY KEY, title TEXT); CREATE VIRTUAL TABLE documents_fts USING fts5(title, content='documents', content_rowid='id'); INSERT INTO documents VALUES(1, 'Saved proposal'), (2, 'Second page');",
    );
    for (const changed of [false, true]) {
      let reads = 0;
      const outputFile = join(
        await mkdtemp(join(tmpdir(), "production-dump-")),
        "dump.sql",
      );
      const operation = dumpDatabase({
        accountId: "a".repeat(32),
        uuid: "11111111-1111-4111-8111-111111111111",
        token: "redacted",
        outputFile,
        stack: "production",
        batchSize: 1,
        fetchImpl: async (url, options) => {
          if (url.endsWith("/bookmark")) {
            return {
              ok: true,
              json: async () => ({
                success: true,
                result: {
                  bookmark:
                    ++reads > 1 && changed ? "new-bookmark" : "old-bookmark",
                },
              }),
            };
          }
          const { sql } = JSON.parse(options.body);
          return {
            ok: true,
            json: async () => ({
              success: true,
              result: [
                {
                  success: true,
                  results: source
                    .prepare(sql)
                    .all()
                    .map((row) => ({ ...row })),
                },
              ],
            }),
          };
        },
      });
      if (changed) {
        await assert.rejects(operation, /changed during/);
        await assert.rejects(access(outputFile));
      } else {
        const summary = await operation;
        assert.equal(summary.rows, 2);
        assert.ok(summary.skipped.includes("documents_fts"));
        const restored = new DatabaseSync(":memory:");
        restored.exec(await readFile(outputFile, "utf8"));
        assert.equal(
          restored
            .prepare(
              "SELECT count(*) AS count FROM documents_fts WHERE documents_fts MATCH 'proposal'",
            )
            .get().count,
          1,
        );
        restored.close();
      }
    }
    source.close();
  });

  it("detects the wrangler virtual-table export refusal", () => {
    assert.equal(
      isVirtualTableExportError(
        new Error(
          "D1 Export error: cannot export databases with virtual tables (like FTS5)",
        ),
      ),
      true,
    );
    assert.equal(isVirtualTableExportError(new Error("boom")), false);
    assert.equal(isVirtualTableExportError(null), false);
  });
});
