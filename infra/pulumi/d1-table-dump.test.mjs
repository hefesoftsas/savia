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
      /production table-dump fallback is disabled/i,
    );
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
