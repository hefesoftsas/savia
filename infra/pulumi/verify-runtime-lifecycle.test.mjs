import test from "node:test";
import assert from "node:assert/strict";
import {
  fixtureWorkerDefinitions,
  validateFixturePrefix,
} from "./verify-runtime-lifecycle.mjs";

test("the lifecycle probe accepts only isolated fixture prefixes", () => {
  assert.equal(
    validateFixturePrefix("savia-iac-fixture-a1234"),
    "savia-iac-fixture-a1234",
  );
  for (const value of [
    "savia-preview",
    "savia-iac-fixture-",
    "savia-iac-fixture-../preview",
    "savia-iac-fixture-A1234",
    "savia-iac-fixture-a".repeat(6),
  ]) {
    assert.throws(() => validateFixturePrefix(value), /fixture prefix/);
  }
});

test("native identities use private ingress and refuse forced deletion", () => {
  const workers = fixtureWorkerDefinitions(
    "savia-iac-fixture-a1234",
    "a".repeat(32),
  );
  assert.deepEqual(
    workers.map(({ role }) => role),
    ["gateway", "api", "auth", "coordinator"],
  );
  for (const { args } of workers) {
    assert.equal(args.accountId, "a".repeat(32));
    assert.equal(args.force, false);
    assert.deepEqual(args.subdomain, {
      enabled: false,
      previewsEnabled: false,
    });
    assert.equal(args.name.startsWith("savia-iac-fixture-a1234-"), true);
  }
  assert.throws(() =>
    fixtureWorkerDefinitions("savia-preview", "a".repeat(32)),
  );
  assert.throws(() =>
    fixtureWorkerDefinitions("savia-iac-fixture-a1234", "bad"),
  );
});
