import assert from "node:assert/strict";
import test from "node:test";

import {
  createProviderSmokePlan,
  executeProviderSmokeOperation,
  parseProviderSmokeArgs,
} from "./provider-connectivity-live-smoke.mjs";

test("caps every public provider at ten estimated HTTP requests", () => {
  const plan = createProviderSmokePlan({ attempts: 10 });

  assert.equal(
    plan.every((item) => item.estimatedRequests <= 10),
    true,
  );
  assert.deepEqual(plan, [
    {
      provider: "sura",
      attempts: 10,
      estimatedRequests: 10,
      operationIds: ["sura-vehicle-by-plate"],
    },
    {
      provider: "sbs",
      attempts: 2,
      estimatedRequests: 8,
      operationIds: ["sbs-product-8-quote"],
    },
  ]);
});

test("classifies a timed-out provider request without leaking a response", async () => {
  const result = await executeProviderSmokeOperation({
    gatewayUrl: "https://gateway.test",
    agencyId: 10,
    operationId: "sura-vehicle-by-plate",
    plate: "REDACTD",
    timeoutMs: 1,
    fetcher: async () => {
      throw new DOMException("Timed out", "TimeoutError");
    },
  });

  assert.deepEqual(result, {
    status: 0,
    errorCode: "EXTERNAL_PROVIDER_TIMEOUT",
  });
});

test("can resume a single provider without consuming another provider budget", () => {
  const plan = createProviderSmokePlan({
    attempts: 3,
    providers: ["sura"],
  });

  assert.deepEqual(plan, [
    {
      provider: "sura",
      attempts: 3,
      estimatedRequests: 3,
      operationIds: ["sura-vehicle-by-plate"],
    },
  ]);
});

test("requires an operator-supplied vehicle registration", () => {
  assert.throws(() => parseProviderSmokeArgs([]), /plate is required/);
});
