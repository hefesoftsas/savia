import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFlowsSecretUploads,
  validateFlowsPreviewSettings,
  validateFlowsWorkerSettings,
} from "./flows-preview-policy.mjs";

test("disabled provisioning requires no Flows keys", () => {
  assert.deepEqual(
    buildFlowsSecretUploads("preview", { SAVIA_FLOWS_PROVISIONED: "false" }),
    [],
  );
});

test("production secret uploads target canonical production Workers", () => {
  const values = {
    SAVIA_FLOWS_PROVISIONED: "true",
    SAVIA_FLOWS_BRIDGE_SECRET: "b".repeat(32),
    SAVIA_FLOWS_JWT_SECRET: "j".repeat(32),
    SAVIA_FLOWS_SECRET_MASTER_KEY: "0".repeat(64),
    SAVIA_FLOWS_FORM_SIGNING_KEY: "f".repeat(32),
  };
  const plans = buildFlowsSecretUploads("production", values);
  assert.equal(plans[0].worker, "savia-flows");
  assert.equal(plans[0].config, "wrangler.production.jsonc");
  assert.equal(plans[1].worker, "savia-agencies");
});
test("enabled provisioning validates all stable keys and both secret targets", () => {
  const values = {
    SAVIA_FLOWS_PROVISIONED: "true",
    SAVIA_FLOWS_BRIDGE_SECRET: "b".repeat(32),
    SAVIA_FLOWS_JWT_SECRET: "j".repeat(32),
    SAVIA_FLOWS_SECRET_MASTER_KEY: "0".repeat(64),
    SAVIA_FLOWS_FORM_SIGNING_KEY: "f".repeat(32),
  };
  const plans = buildFlowsSecretUploads("preview", values);
  assert.equal(plans[0].worker, "savia-flows-preview");
  assert.deepEqual(Object.keys(plans[0].secrets), [
    "SAVIA_FLOWS_BRIDGE_SECRET",
    "JWT_SECRET",
    "SECRET_MASTER_KEY",
    "FORM_SIGNING_KEY",
  ]);
  assert.equal(plans[1].worker, "savia-agencies-preview");
  for (const key of Object.keys(values).filter(
    (key) => key !== "SAVIA_FLOWS_PROVISIONED",
  ))
    assert.throws(
      () => buildFlowsSecretUploads("preview", { ...values, [key]: "" }),
      /required|invalid/,
    );
  assert.throws(
    () =>
      buildFlowsSecretUploads("preview", {
        ...values,
        SAVIA_FLOWS_SECRET_MASTER_KEY: "weak",
      }),
    /invalid/,
  );
});
test("deployed Worker policy must retain isolated bindings and quotas", () => {
  const bindings = [
    { name: "SAVIA_HOST", type: "service", service: "savia-agencies-preview" },
    {
      name: "CODE_EXECUTOR",
      type: "service",
      service: "savia-hook-executor-preview",
      entrypoint: "FlowsExecutor",
    },
    ...Object.entries({
      SAVIA_FLOWS_EXTERNAL_SERVICES_ENABLED: "false",
      SAVIA_FLOWS_EXECUTION_ENABLED: "false",
      SAVIA_FLOWS_QUOTAS_ENABLED: "true",
      SAVIA_FLOWS_POLICY_GENERATION: "10",
      SAVIA_FLOWS_MAX_DAILY_RUNS: "100",
      SAVIA_FLOWS_MAX_MONTHLY_RUNS: "1000",
      SAVIA_FLOWS_MAX_CONCURRENT_RUNS: "2",
      SAVIA_FLOWS_MAX_NODES_PER_RUN: "50",
      SAVIA_FLOWS_MAX_STEPS_PER_RUN: "200",
    }).map(([name, text]) => ({ name, text, type: "plain_text" })),
  ];
  assert.doesNotThrow(() => validateFlowsPreviewSettings({ bindings }, false));
  assert.throws(
    () =>
      validateFlowsPreviewSettings(
        {
          bindings: bindings.filter(
            (binding) => binding.name !== "SAVIA_FLOWS_POLICY_GENERATION",
          ),
        },
        false,
      ),
    /generation/,
  );
  assert.throws(
    () =>
      validateFlowsPreviewSettings(
        { bindings: [...bindings, { name: "AI", type: "ai" }] },
        false,
      ),
    /External/,
  );
  assert.throws(
    () =>
      validateFlowsPreviewSettings(
        {
          bindings: bindings.filter(
            (binding) => binding.name !== "SAVIA_FLOWS_MAX_DAILY_RUNS",
          ),
        },
        false,
      ),
    /quota/,
  );
  assert.throws(
    () => validateFlowsPreviewSettings({ bindings }, true),
    /execution/,
  );
});

test("production policy keeps private executor and API bindings with external services disabled", () => {
  const bindings = [
    { name: "SAVIA_HOST", type: "service", service: "savia-agencies" },
    {
      name: "CODE_EXECUTOR",
      type: "service",
      service: "savia-hook-executor",
      entrypoint: "FlowsExecutor",
    },
    ...Object.entries({
      SAVIA_FLOWS_EXTERNAL_SERVICES_ENABLED: "false",
      SAVIA_FLOWS_EXECUTION_ENABLED: "false",
      SAVIA_FLOWS_QUOTAS_ENABLED: "true",
      SAVIA_FLOWS_POLICY_GENERATION: "10",
      SAVIA_FLOWS_MAX_DAILY_RUNS: "100",
      SAVIA_FLOWS_MAX_MONTHLY_RUNS: "1000",
      SAVIA_FLOWS_MAX_CONCURRENT_RUNS: "2",
      SAVIA_FLOWS_MAX_NODES_PER_RUN: "50",
      SAVIA_FLOWS_MAX_STEPS_PER_RUN: "200",
    }).map(([name, text]) => ({ name, text, type: "plain_text" })),
  ];
  assert.doesNotThrow(() =>
    validateFlowsWorkerSettings({ bindings }, false, "production"),
  );
  assert.throws(
    () =>
      validateFlowsWorkerSettings(
        { bindings: [...bindings, { name: "AI", type: "ai" }] },
        false,
        "production",
      ),
    /External/,
  );
});
