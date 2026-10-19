import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ownershipWorkflows,
  validateWorkflowJournal,
  assertBookkeepingPlan,
  migrateEnvironmentOwnership,
} from "./environment-ownership.mjs";
const originals = ownershipWorkflows.map((name, index) => ({
  id: index + 1,
  path: `.github/workflows/${name}`,
  originalState: [
    "backup-production.yml",
    "check-production-backups.yml",
    "deploy-cloudflare.yml",
    "import-savia-request-variables.yml",
  ].includes(name)
    ? "disabled_manually"
    : "active",
}));
test("workflow restoration journal rejects omitted mutators and re-enabling stopped production", () => {
  assert.equal(validateWorkflowJournal(originals, originals).length, 9);
  assert.throws(
    () => validateWorkflowJournal(originals.slice(1), originals),
    /Exact/,
  );
  assert.throws(
    () =>
      validateWorkflowJournal(
        originals.map((row) => ({ ...row, originalState: "active" })),
        originals,
      ),
    /production/,
  );
  assert.throws(
    () =>
      validateWorkflowJournal(
        originals.map((row) => ({ ...row, id: 99 })),
        originals,
      ),
    /identity/,
  );
});
test("post-move plans reject any cloud write, replacement, import or deletion", () => {
  assertBookkeepingPlan({
    steps: [
      { op: "update", type: "pulumi:pulumi:Stack" },
      { op: "create", type: "pulumi:providers:cloudflare" },
      { op: "same", type: "cloudflare:index/r2Bucket:R2Bucket" },
    ],
  });
  for (const op of ["create", "update", "import", "delete", "replace"])
    assert.throws(
      () =>
        assertBookkeepingPlan({
          steps: [{ op, type: "cloudflare:index/r2Bucket:R2Bucket" }],
        }),
      /cloud resource mutation/,
    );
});
test("changed reviewed custody freezes workflows and stops before Pulumi mutation or restoration", async () => {
  const directory = await mkdtemp(join(tmpdir(), "savia-ownership-test-"));
  await rm(directory, { recursive: true });
  const calls = [],
    env = {
      GITHUB_REF: "refs/heads/main",
      GITHUB_SHA: "a".repeat(40),
      GITHUB_REPOSITORY: "hefesoftsas/savia",
      GITHUB_RUN_ID: "12",
      CLOUDFLARE_ACCOUNT_ID: "b".repeat(32),
      PULUMI_BACKEND_URL: `s3://savia-pulumi-state-preview?endpoint=${"b".repeat(32)}.r2.cloudflarestorage.com&region=auto&s3ForcePathStyle=true`,
    };
  const { stateBackendUrl } = await import("./naming.mjs");
  env.PULUMI_BACKEND_URL = stateBackendUrl(
    env.CLOUDFLARE_ACCOUNT_ID,
    "savia-pulumi-state-preview",
  );
  const run = async (binary, args) => {
    calls.push({ binary, args });
    assert.equal(binary, "gh");
    let result = null;
    if (args[1].includes("actions/workflows?"))
      result = {
        workflows: originals.map((row) => ({
          ...row,
          state: "disabled_manually",
        })),
      };
    else if (args[1].endsWith("commits/main")) result = { sha: env.GITHUB_SHA };
    else if (args[1].includes("/runs?")) result = { workflow_runs: [] };
    return { stdout: JSON.stringify(result) };
  };
  try {
    await assert.rejects(
      migrateEnvironmentOwnership({
        reviewed: { version: 2, unclassifiedSaviaResources: [] },
        originalWorkflows: originals,
        directory,
        env,
        run,
        audit: async () => ({ result: { version: 2 }, checkpoints: [] }),
      }),
      /changed since the reviewed audit/,
    );
    assert.equal(
      calls.filter((call) => call.args[1].endsWith("/disable")).length,
      9,
    );
    assert.equal(
      calls.some((call) => call.args[1].endsWith("/enable")),
      false,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a reviewed audit with unclassified Savia resources stops before workflow or state mutations", async () => {
  await assert.rejects(
    migrateEnvironmentOwnership({
      reviewed: {
        version: 2,
        unclassifiedSaviaResources: [
          { kind: "d1", name: "savia-legacy", cloudId: "legacy" },
        ],
      },
      originalWorkflows: originals,
      directory: "/tmp/must-not-create-ownership",
      env: {
        GITHUB_REF: "refs/heads/main",
        GITHUB_REPOSITORY: "hefesoftsas/savia",
      },
      run: async () => assert.fail("attempted mutation"),
    }),
    /Unclassified Savia/,
  );
});

test("legacy audit evidence is rejected before creating operation custody or freezing workflows", async () => {
  for (const reviewed of [
    { version: 1 },
    { version: 2 },
    { version: 1, unclassifiedSaviaResources: [] },
  ])
    await assert.rejects(
      migrateEnvironmentOwnership({
        reviewed,
        directory: "/tmp/must-not-create-legacy-audit",
        env: {
          GITHUB_REF: "refs/heads/main",
          GITHUB_REPOSITORY: "hefesoftsas/savia",
        },
        run: async () => assert.fail("attempted workflow mutation"),
      }),
      /version-2 ownership audit/,
    );
});
