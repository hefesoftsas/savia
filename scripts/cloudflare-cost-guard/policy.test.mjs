import test from "node:test";
import assert from "node:assert/strict";
import { parsePolicy } from "./policy.mjs";

test("accepts explicit pause targets and guard exclusions", () => {
  const policy = parsePolicy({
    guardScript: "cost-guard",
    backupBarrierScripts: ["backup-barrier"],
    scripts: [
      { script: "application-worker", variables: { COST_GUARD_PAUSED: "true" } },
    ],
    schedules: ["agency-api"],
    queues: ["queue-123"],
    workflows: ["pipeline"],
    aiSearch: [{ namespace: "docs", id: "kb-main" }],
  });
  assert.equal(policy.scripts[0].script, "application-worker");
  assert.deepEqual(policy.queues, ["queue-123"]);
  assert.deepEqual(policy.workflows, ["pipeline"]);
  assert.deepEqual(policy.aiSearch, [{ namespace: "docs", id: "kb-main" }]);
});

test("rejects guard and backup barrier targets", () => {
  assert.throws(
    () =>
      parsePolicy({
        guardScript: "cost-guard",
        backupBarrierScripts: ["backup"],
        scripts: [{ script: "backup" }],
      }),
    /protected/i,
  );
  assert.throws(
    () =>
      parsePolicy({
        guardScript: "cost-guard",
        backupBarrierScripts: [],
        scripts: [{ script: "cost-guard" }],
      }),
    /protected/i,
  );
});

test("rejects malformed, duplicate, or implicit account-wide policy", () => {
  assert.throws(
    () =>
      parsePolicy({
        guardScript: "guard",
        backupBarrierScripts: [],
        scripts: [{ script: "x" }, { script: "x" }],
      }),
    /duplicate/i,
  );
  assert.throws(
    () =>
      parsePolicy({
        guardScript: "guard",
        backupBarrierScripts: [],
        queues: ["*"],
      }),
    /invalid/i,
  );
  assert.throws(
    () =>
      parsePolicy({
        guardScript: "guard",
        backupBarrierScripts: [],
        scripts: "all",
      }),
    /array/i,
  );
});

test("accepts explicit account-wide discovery and Cloudflare AI denial policy", () => {
  const policy = parsePolicy({
    guardScript: "cost-guard",
    backupBarrierScripts: ["backup"],
    accountWide: true,
    denyCloudflareAi: true,
  });
  assert.equal(policy.accountWide, true);
  assert.equal(policy.denyCloudflareAi, true);
});

test("requires explicit boolean account-wide policy flags", () => {
  for (const patch of [{ accountWide: "yes" }, { denyCloudflareAi: 1 }]) {
    assert.throws(
      () => parsePolicy({ guardScript: "guard", ...patch }),
      /boolean/i,
    );
  }
});

test("preserves explicit maintenance schedules without protecting their public endpoints", () => {
  const parsed = parsePolicy({
    guardScript: "guard",
    maintenanceSchedules: ["cleanup"],
  });
  assert.deepEqual(parsed.maintenanceSchedules, ["cleanup"]);
  assert.deepEqual(parsed.backupBarrierScripts, []);
  assert.throws(
    () => parsePolicy({ guardScript: "guard", maintenanceSchedules: ["*"] }),
    /invalid/,
  );
  assert.throws(
    () =>
      parsePolicy({
        guardScript: "guard",
        maintenanceSchedules: ["cleanup", "cleanup"],
      }),
    /duplicate/,
  );
});
