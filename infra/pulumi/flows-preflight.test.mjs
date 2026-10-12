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
