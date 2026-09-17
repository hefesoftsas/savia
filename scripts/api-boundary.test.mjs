import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
test("core composition does not register legacy business implementations", () => {
  const core = readFileSync(
    new URL("../apps/api/src/app.ts", import.meta.url),
    "utf8",
  );
  for (const legacy of [
    "registerDomainRoutes",
    "registerInsuranceResultRoutes",
  ])
    assert.ok(!core.includes(legacy), legacy);
  assert.ok(core.includes("registerCrmAutomaticSyncRoutes"));
  assert.equal(
    existsSync(new URL("../apps/legacy-api/src/index.ts", import.meta.url)),
    false,
  );
});
