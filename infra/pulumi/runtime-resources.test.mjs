import test from "node:test";
import assert from "node:assert/strict";
import {
  workerIdentityArgs,
  runtimeRegistrationPlan,
  workerIdentityOptions,
} from "./runtime-resources.mjs";
import { previewNames } from "../../scripts/preview-environment.mjs";
const accountId = "a".repeat(32);
test("native Worker arguments cannot take over publication or force deletion", () => {
  assert.deepEqual(workerIdentityArgs({ accountId, name: "savia-preview" }), {
    accountId,
    name: "savia-preview",
    force: false,
  });
  assert.equal(workerIdentityOptions().protect, true);
  assert.ok(workerIdentityOptions().ignoreChanges.includes("subdomain"));
  assert.ok(workerIdentityOptions().ignoreChanges.includes("force"));
  assert.throws(
    () => workerIdentityArgs({ accountId, name: "other-product" }),
    /Worker/,
  );
});
test("registration preserves the exact ten-Worker Preview and six-Worker retained branch profiles", () => {
  const preview = [
    "savia-preview",
    "savia-agencies-preview",
    "savia-auth-preview",
    "savia-mcp-preview",
    "savia-request-preview",
    "savia-connectors-preview",
    "savia-hook-executor-preview",
    "savia-flows-preview",
    "savia-backup-coordinator-preview",
    "savia-plugin-editor-preview",
  ];
  const p = runtimeRegistrationPlan({
    accountId,
    environment: "preview",
    profile: { enabledWorkers: preview },
  });
  assert.equal(p.workers.length, 10);
  assert.equal(
    p.workers.every((row) => row.options.protect && row.args.force === false),
    true,
  );
  const branch = Object.values(
    previewNames("feat-secop-tender-tracke").workers,
  ).filter((name) => !name.includes("connectors"));
  const b = runtimeRegistrationPlan({
    accountId,
    environment: "branch-feat-secop-tender-tracke",
    profile: { enabledWorkers: branch },
  });
  assert.equal(b.workers.length, 6);
  assert.deepEqual(b.workers.map((w) => w.args.name).sort(), branch.sort());
  const shared = runtimeRegistrationPlan({
    accountId,
    environment: "shared",
    profile: { enabledWorkers: ["savia-plugin-registry"] },
  });
  assert.equal(shared.workers[0].options.protect, true);
});
test("Worker imports are account-scoped and limited to explicit one-time adoption", () => {
  const manifest = {
    version: 1,
    accountId,
    environment: "preview",
    project: "savia-cloudflare",
    stack: "preview",
    profile: { enabledWorkers: ["savia-preview"] },
    resources: [
      { kind: "worker", name: "savia-preview", cloudId: "b".repeat(32) },
    ],
  };
  const args = {
    accountId,
    environment: "preview",
    manifest,
    profile: manifest.profile,
  };
  assert.equal(
    runtimeRegistrationPlan({ ...args, importExisting: true }).workers[0]
      .options.import,
    `${accountId}/${"b".repeat(32)}`,
  );
  assert.equal(
    runtimeRegistrationPlan(args).workers[0].options.import,
    undefined,
  );
  assert.throws(
    () =>
      runtimeRegistrationPlan({
        ...args,
        manifest: { ...manifest, accountId: "c".repeat(32) },
        importExisting: true,
      }),
    /account/i,
  );
  assert.throws(
    () =>
      runtimeRegistrationPlan({
        ...args,
        profile: { enabledWorkers: ["other-product"] },
      }),
    /Worker|profile/,
  );
});
