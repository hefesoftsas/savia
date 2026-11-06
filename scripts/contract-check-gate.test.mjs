import assert from "node:assert/strict";
import test from "node:test";
import { evaluateContractGate } from "./contract-check-gate.mjs";

const needs = (ciKind, contractResult) => ({
  changes: {
    result: "success",
    outputs: { kind: "platform", ci_kind: ciKind },
  },
  "plugin-validation": { result: "skipped" },
  "runtime-profile": { result: "skipped" },
  "contract-suite":
    contractResult === undefined ? {} : { result: contractResult },
});

test("contract gate accepts ci-config only when classification and contracts succeeded", () => {
  assert.deepEqual(evaluateContractGate(needs("ci-config", "success")), []);

  for (const contractResult of ["failure", "cancelled", "skipped", undefined]) {
    assert.notDeepEqual(
      evaluateContractGate(needs("ci-config", contractResult)),
      [],
    );
  }

  const failedClassification = needs("ci-config");
  failedClassification.changes.result = "failure";
  assert.ok(evaluateContractGate(failedClassification).length > 0);
});

test("contract gate rejects unknown CI kinds", () => {
  const failures = evaluateContractGate(needs("ci-config-unknown"));
  assert.ok(
    failures.some((failure) =>
      failure.includes("CI kind was invalid: ci-config-unknown"),
    ),
  );
});
