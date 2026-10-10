import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  shadowTablesFor,
  isSkippedTable,
  isPlatformTable,
  quoteIdent,
  formatValue,
  buildInsert,
  buildSelectPage,
  isVirtualTableExportError,
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
      `INSERT INTO "tenants" ("id","name") VALUES (1,'a''b');`,
    );
    assert.equal(
      buildSelectPage("tenants", ["id"], 200, 400),
      `SELECT "id" FROM "tenants" ORDER BY rowid LIMIT 200 OFFSET 400`,
    );
    assert.throws(() => buildInsert("t", [], {}));
  });

  it("detects the wrangler virtual-table export refusal", () => {
    assert.equal(
      isVirtualTableExportError(
        new Error("D1 Export error: cannot export databases with virtual tables (like FTS5)"),
      ),
      true,
    );
    assert.equal(isVirtualTableExportError(new Error("boom")), false);
    assert.equal(isVirtualTableExportError(null), false);
  });
});
