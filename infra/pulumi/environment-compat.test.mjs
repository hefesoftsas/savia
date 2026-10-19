import test from "node:test";
import assert from "node:assert/strict";
import { legacyDestroyTarget } from "./environment-compat.mjs";
test("historical branch --force authorizes retirement but never implies data deletion", () => {
  assert.deepEqual(
    legacyDestroyTarget("branch", ["--branch", "feature-login", "--force"]),
    { environment: "branch-feature-login", apply: true, deleteData: false },
  );
  assert.equal(
    legacyDestroyTarget("branch", [
      "--branch",
      "feature-login",
      "--force",
      "--delete-data",
    ]).deleteData,
    true,
  );
  assert.throws(() =>
    legacyDestroyTarget("branch", ["--branch", "main", "--force"]),
  );
  assert.throws(() =>
    legacyDestroyTarget("branch", ["--branch", "feature-login"]),
  );
});
test("legacy application destroy retains production acknowledgment and explicit data flags", () => {
  assert.throws(() =>
    legacyDestroyTarget("application", ["--stack", "production", "--apply"]),
  );
  assert.equal(
    legacyDestroyTarget("application", ["--stack", "preview", "--apply"])
      .deleteData,
    false,
  );
  assert.throws(() =>
    legacyDestroyTarget("application", ["--stack", "management", "--apply"]),
  );
});
