import assert from "node:assert/strict";
import test from "node:test";

import {
  assertDeletionInventory,
  legacyResources,
  parseReplacementArgs,
  renderWorkerConfigs,
  validateState,
} from "./replacement-state.mjs";

const replacementState = {
  accountId: "account-id",
  accountSubdomain: "savia-account",
  publicOrigin: "https://savia.savia-account.workers.dev",
  domainD1Id: "domain-d1-id",
  authD1Id: "auth-d1-id",
  documentsBucket: "savia-documents",
  stagingBucket: "savia-migration-staging",
};

test("requires --apply for every mutating command", () => {
  for (const command of ["provision", "deploy-next", "cutover", "cleanup"]) {
    assert.throws(() => parseReplacementArgs([command]), /requires --apply/);
  }
});

test("accepts inventory without --apply", () => {
  assert.deepEqual(parseReplacementArgs(["inventory"]), {
    command: "inventory",
    apply: false,
  });
});

test("refuses a deletion inventory containing an unapproved resource", () => {
  assert.throws(
    () =>
      assertDeletionInventory({
        workers: ["savia"],
        d1: ["savia-core", "savia-nocobase-r2-secure-dev"],
        r2: [],
        kv: [],
        queues: [],
      }),
    /not approved for deletion/,
  );
});

test("requires each opaque identifier in replacement state", () => {
  assert.throws(
    () => validateState({ accountId: "account-id" }),
    /accountSubdomain/,
  );
});

test("renders next and final configs with the replacement bindings only", () => {
  const state = validateState(replacementState);
  const configs = renderWorkerConfigs(state);

  assert.equal(configs.next.gateway.name, "savia-next");
  assert.equal(configs.next.api.name, "savia-agencies-next");
  assert.equal(configs.next.auth.name, "savia-auth-next");
  assert.equal(configs.final.gateway.name, "savia");
  assert.equal(configs.final.api.d1_databases[0].database_id, "domain-d1-id");
  assert.equal(configs.final.auth.d1_databases[0].database_id, "auth-d1-id");
  assert.deepEqual(legacyResources.workers, ["savia"]);
});
