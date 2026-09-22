import assert from "node:assert/strict";
import test from "node:test";

import {
  findDatabaseUuid,
  maskSecret,
  validatePublicOrigin,
} from "./setup.mjs";
import {
  DEMO_CUSTOMERS,
  DEMO_TENANT,
  extractSessionCookie,
} from "./seed-demo.mjs";

test("accepts https origins with real domains only", () => {
  assert.equal(
    validatePublicOrigin("https://demo.example.com/"),
    "https://demo.example.com",
  );
  for (const bad of [
    "http://demo.example.com",
    "https://localhost",
    "notaurl",
    "",
  ]) {
    assert.throws(() => validatePublicOrigin(bad), /HTTPS|domain|Invalid URL/);
  }
});

test("masks secrets for logs", () => {
  assert.equal(maskSecret("abcdefghij123"), "abc…23");
  assert.equal(maskSecret("short"), "****");
});

test("finds database uuids", () => {
  const rows = [
    { name: "savia-agencies", uuid: "11111111-2222-3333-4444-555555555555" },
  ];
  assert.equal(
    findDatabaseUuid(JSON.stringify(rows), "savia-agencies"),
    "11111111-2222-3333-4444-555555555555",
  );
  assert.equal(findDatabaseUuid("[]", "missing"), null);
  assert.equal(findDatabaseUuid("not-json", "missing"), null);
});

test("extracts session cookies from set-cookie headers", () => {
  assert.equal(
    extractSessionCookie([
      "savia.session=a1b2; Path=/; HttpOnly",
      "other=x; Path=/",
    ]),
    "savia.session=a1b2; other=x",
  );
  assert.equal(
    extractSessionCookie("savia.session=a1b2; Path=/; HttpOnly"),
    "savia.session=a1b2",
  );
  assert.throws(() => extractSessionCookie([]), /no session cookie/);
});

test("demo content is small and fixed", () => {
  assert.equal(DEMO_TENANT.idSlug, "demo");
  assert.equal(DEMO_CUSTOMERS.length, 3);
  for (const customer of DEMO_CUSTOMERS) {
    assert.ok(customer.name.length > 0);
  }
});
