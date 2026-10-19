import assert from "node:assert/strict";
import test from "node:test";
import { validatePlannedFlows } from "./flows-preflight.mjs";
test("separates resource retention from execution pause", () => {
  assert.deepEqual(
    validatePlannedFlows({ provisioned: false, executionEnabled: false }, {}),
    {
      SAVIA_FLOWS_PLANNED: "false",
      SAVIA_FLOWS_PLANNED_EXECUTION_ENABLED: "false",
    },
  );
  assert.throws(
    () =>
      validatePlannedFlows({ provisioned: false, executionEnabled: true }, {}),
    /Invalid/,
  );
  assert.throws(
    () =>
      validatePlannedFlows(
        { provisioned: false, executionEnabled: false },
        { SAVIA_FLOWS_PROVISIONED: "true" },
      ),
    /preserve data/,
  );
  assert.throws(
    () =>
      validatePlannedFlows(
        { provisioned: true, executionEnabled: false },
        { SAVIA_FLOWS_PROVISIONED: "true" },
      ),
    /BACKUP_KEY/,
  );
});

test("validates the production stack's planned Flows secrets without activating production", () => {
  const outputs = validatePlannedFlows(
    { provisioned: true, executionEnabled: false },
    {
      SAVIA_FLOWS_PROVISIONED: "false",
      SAVIA_FLOWS_BRIDGE_SECRET: "bridge-secret-value-with-at-least-32-bytes",
      SAVIA_FLOWS_JWT_SECRET: "jwt-secret-value-with-at-least-32-bytes",
      SAVIA_FLOWS_SECRET_MASTER_KEY: "a".repeat(64),
      SAVIA_FLOWS_FORM_SIGNING_KEY: "form-signing-key-with-at-least-32-bytes",
      SAVIA_FLOWS_BACKUP_KEY: "b".repeat(64),
    },
    "production",
  );
  assert.equal(outputs.SAVIA_FLOWS_PLANNED, "true");
  assert.equal(outputs.SAVIA_FLOWS_PLANNED_EXECUTION_ENABLED, "false");
});
