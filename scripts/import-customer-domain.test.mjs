import assert from "node:assert/strict";
import test from "node:test";

import {
  buildInsertStatement,
  convertSourceValue,
  countryReconciliationStatements,
  customerImportPlan,
  parseCsv,
} from "./import-customer-domain.mjs";

test("orders customer dependencies before the records that reference them", () => {
  const position = new Map(
    customerImportPlan.map(({ sourceTable }, index) => [sourceTable, index]),
  );

  assert.ok(
    position.get("business_agency") < position.get("customer_clientagency"),
  );
  assert.ok(
    position.get("customer_address") < position.get("customer_naturalperson"),
  );
  assert.ok(
    position.get("customer_clientagency") < position.get("customer_document"),
  );
  assert.ok(
    position.get("app_documenttag") < position.get("customer_document_tags"),
  );
  assert.ok(
    position.get("customer_legalperson") < position.get("customer_consortium"),
  );
  assert.ok(position.get("app_country") < position.get("app_department"));
  assert.ok(position.get("app_department") < position.get("app_city"));
  assert.ok(position.get("app_city") < position.get("customer_address"));
  assert.ok(
    position.get("app_economicactivity") < position.get("customer_legalperson"),
  );
});

test("preserves exact numeric values and every natural-person email", () => {
  assert.equal(
    convertSourceValue("1234567890123.45", {
      dataType: "numeric",
      columnName: "amount",
    }),
    "'1234567890123.45'",
  );
  assert.equal(
    convertSourceValue('{"one@example.test","two@example.test"}', {
      dataType: "ARRAY",
      columnName: "email",
    }),
    '\'["one@example.test","two@example.test"]\'',
  );
  assert.equal(
    convertSourceValue("t", { dataType: "boolean", columnName: "active" }),
    "1",
  );
  assert.equal(
    convertSourceValue("\\N", { dataType: "text", columnName: "note" }),
    "NULL",
  );
});

test("strips optional audit users and creates an idempotent D1 upsert", () => {
  const statement = buildInsertStatement(
    {
      sourceTable: "customer_document",
      targetTable: "customer_document",
      nullColumns: ["uploaded_by_id"],
    },
    [
      { columnName: "id", dataType: "bigint" },
      { columnName: "name", dataType: "character varying" },
      { columnName: "uploaded_by_id", dataType: "integer" },
      { columnName: "reader_data", dataType: "jsonb" },
    ],
    ["31", "Policy copy", "9", '{"pageCount":2}'],
  );

  assert.equal(
    statement,
    "INSERT INTO customer_document (id, name, uploaded_by_id, reader_data) VALUES (31, 'Policy copy', NULL, '{\"pageCount\":2}') ON CONFLICT(id) DO UPDATE SET name = excluded.name, uploaded_by_id = excluded.uploaded_by_id, reader_data = excluded.reader_data;",
  );
});

test("reconciles pre-existing countries by code before importing source IDs", () => {
  assert.deepEqual(countryReconciliationStatements([["1", "CO"]]), [
    "UPDATE departments SET country_id = 1 WHERE country_id IN (SELECT id FROM countries WHERE code = 'CO' AND id <> 1);",
    "UPDATE countries SET id = 1 WHERE code = 'CO' AND id <> 1;",
  ]);
});

test("parses quoted source CSV fields without changing their values", () => {
  assert.deepEqual(parseCsv('7,"Avenida, 5","{""source"":""postgres""}"\n'), [
    ["7", "Avenida, 5", '{"source":"postgres"}'],
  ]);
});
