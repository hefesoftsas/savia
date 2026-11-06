import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

async function manifest(path) {
  return JSON.parse(
    await readFile(fileURLToPath(new URL(path, import.meta.url)), "utf8"),
  );
}

test("current insurance packages keep quoting optional for management tenants", async () => {
  const quoter = await manifest("../solutions/insurance-quoter/manifest.json");
  const management = await manifest(
    "../solutions/insurance-management/manifest.json",
  );

  assert.equal(quoter.format, "savia.solution");
  assert.equal(quoter.id, "savia.insurance-quoter");
  assert.deepEqual(quoter.requires, ["insurance.quotes"]);
  assert.equal(management.format, "savia.solution");
  assert.equal(management.id, "savia.insurance-management");
  assert.deepEqual(management.requires, []);
  assert.ok(management.objects.length > 0);
});
