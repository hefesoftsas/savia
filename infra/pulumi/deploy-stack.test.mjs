import assert from "node:assert/strict";
import test from "node:test";
import {
  parseDeployArgs,
  assertSafePlan,
  assertBackendConfigured,
} from "./deploy-stack.mjs";

test("deployment chooses an explicit stack and never creates an empty one", () => {
  assert.deepEqual(parseDeployArgs(["--stack", "preview", "--apply"]), {
    stack: "preview",
    apply: true,
  });
  assert.deepEqual(parseDeployArgs(["--stack", "production", "--preview"]), {
    stack: "production",
    apply: false,
  });
  assert.throws(() => parseDeployArgs(["--stack", "qa", "--apply"]));
  assert.throws(() => parseDeployArgs(["--stack", "preview"]));
});

test("the deployment backend must be remote and have encrypted-state credentials", () => {
  assert.throws(() => assertBackendConfigured({}), /backend/i);
  assert.throws(
    () => assertBackendConfigured({ PULUMI_BACKEND_URL: "file:///tmp/new" }),
    /remote/i,
  );
  assert.throws(
    () => assertBackendConfigured({ PULUMI_BACKEND_URL: "s3://state" }),
    /passphrase/i,
  );
  assert.throws(
    () =>
      assertBackendConfigured({
        PULUMI_BACKEND_URL: "s3://state",
        PULUMI_CONFIG_PASSPHRASE: "secret",
      }),
    /credentials/i,
  );
  assertBackendConfigured({
    PULUMI_BACKEND_URL: "s3://state",
    PULUMI_CONFIG_PASSPHRASE: "secret",
    AWS_ACCESS_KEY_ID: "key",
    AWS_SECRET_ACCESS_KEY: "secret",
  });
});

test("resource creation and updates are reviewable but deletion and replacements stop deployment", () => {
  assertSafePlan({ changeSummary: { same: 4 } });
  assertSafePlan({ changeSummary: { create: 1, same: 4 } });
  assertSafePlan({ changeSummary: { import: 2, same: 4 } });
  for (const operation of [
    "delete",
    "replace",
    "create-replacement",
    "delete-replaced",
    "discard-replaced",
    "import-replacement",
  ])
    assert.throws(
      () => assertSafePlan({ changeSummary: { [operation]: 1 } }),
      /destruct|replac|delete/i,
    );
  assert.throws(() => assertSafePlan({}), /plan/i);
});
