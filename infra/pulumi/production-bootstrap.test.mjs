import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertProductionBootstrapPlan,
  validateBootstrapSecrets,
  bootstrapProduction,
} from "./production-bootstrap.mjs";
import { stateBackendUrl, productionBackupLifecycleRule } from "./naming.mjs";

const accountId = "a".repeat(32);
const expected = [
  [
    "auth-db",
    "d1Database:D1Database",
    "savia-auth-local-canonical-20260913-v2",
  ],
  [
    "domain-db",
    "d1Database:D1Database",
    "savia-agencies-local-canonical-20260913-v2",
  ],
  ["documents", "r2Bucket:R2Bucket", "savia-documents"],
  ["production-backups", "r2Bucket:R2Bucket", "savia-production-backups"],
  ["production-backups-lifecycle", "r2BucketLifecycle:R2BucketLifecycle"],
  ["production-backups-public-access", "r2ManagedDomain:R2ManagedDomain"],
];
const plan = () => ({
  accountId,
  environment: "production",
  operation: "provision",
  manifest: { resources: [] },
  steps: expected.map(([logical, type, name]) => ({
    op: "create",
    accountId,
    name,
    type: `cloudflare:index/${type}`,
    ...(logical === "production-backups" ? { storageClass: "Standard" } : {}),
    ...(logical === "production-backups-lifecycle"
      ? {
          bucketName: "savia-production-backups",
          rules: [productionBackupLifecycleRule()],
        }
      : {}),
    ...(logical === "production-backups-public-access"
      ? { bucketName: "savia-production-backups", enabled: false }
      : {}),
    urn: `urn:pulumi:production::savia-cloudflare::cloudflare:index/${type}::${logical}`,
  })),
});
test("bootstrap accepts only the exact fresh production persistence creation", () => {
  assert.equal(assertProductionBootstrapPlan(plan(), accountId), true);
  for (const mutate of [
    (p) => (p.steps[0].op = "update"),
    (p) => (p.steps[0].accountId = "b".repeat(32)),
    (p) => (p.steps[0].name += "-preview"),
    (p) =>
      (p.steps[0].urn = p.steps[0].urn.replace("production::", "preview::")),
    (p) =>
      p.steps.push({ op: "create", type: "cloudflare:index/worker:Worker" }),
    (p) => p.steps.pop(),
    (p) => p.steps.push(p.steps[0]),
    (p) => p.manifest.resources.push({ kind: "d1" }),
    (p) => (p.operation = "release"),
    (p) => (p.steps[3].storageClass = "InfrequentAccess"),
    (p) => (p.steps[4].rules[0].conditions.prefix = ""),
    (p) => (p.steps[5].enabled = true),
  ]) {
    const value = plan();
    mutate(value);
    assert.throws(() => assertProductionBootstrapPlan(value, accountId));
  }
});
const secrets = () => ({
  BETTER_AUTH_SECRET: "auth",
  SAVIA_MCP_SHARED_SECRET: "mcp",
  SAVIA_REQUEST_ENCRYPTION_KEY: "request",
  EXTENSION_CONNECTIONS_ENCRYPTION_KEY: "connections",
  ASSISTANT_SETTINGS_ENCRYPTION_KEY: "assistant",
  CRM_INTEGRATION_KEY: "crm",
  NANGO_API_KEY: "nango",
  SAVIA_BACKUP_CONTROL_SECRET: "b".repeat(64),
  SAVIA_BACKUP_KEY: "c".repeat(64),
  R2_BACKUP_ACCESS_KEY_ID: "r2-id",
  R2_BACKUP_SECRET_ACCESS_KEY: "r2-secret",
});
test("all application and backup credentials are required before creating persistence", () => {
  assert.doesNotThrow(() => validateBootstrapSecrets(secrets()));
  for (const key of Object.keys(secrets())) {
    const value = secrets();
    delete value[key];
    assert.throws(() => validateBootstrapSecrets(value));
  }
});

test("initialization applies only its reviewed saved plan after validating credentials and identity", async () => {
  const directory = await mkdtemp(join(tmpdir(), "savia-bootstrap-test-"));
  try {
    const planPath = join(directory, "provision.json");
    const env = {
      ...secrets(),
      PRODUCTION_OPERATIONS_ENABLED: "true",
      GITHUB_REF: "refs/heads/main",
      CLOUDFLARE_ACCOUNT_ID: accountId,
      PULUMI_BACKEND_URL: stateBackendUrl(
        accountId,
        "savia-pulumi-state-preview",
      ),
      PULUMI_CONFIG_PASSPHRASE: "passphrase",
      AWS_ACCESS_KEY_ID: "id",
      AWS_SECRET_ACCESS_KEY: "secret",
      GITHUB_STEP_SUMMARY: join(directory, "summary.md"),
    };
    const calls = [];
    const run = async (_command, args) => {
      calls.push(args);
      return { stdout: JSON.stringify(plan()) };
    };
    await bootstrapProduction({ planPath, env, run });
    assert.deepEqual(
      calls.map((args) => args[1]),
      ["plan", "apply"],
    );
    assert.deepEqual(calls[1], [
      "infra/pulumi/environment.mjs",
      "apply",
      "--environment",
      "production",
      "--provision",
      "--plan",
      planPath,
      "--apply",
    ]);
    assert.match(await readFile(env.GITHUB_STEP_SUMMARY, "utf8"), /six|two D1/);
    for (const invalid of [
      { ...env, NANGO_API_KEY: "" },
      { ...env, GITHUB_REF: "refs/heads/feature" },
      { ...env, PRODUCTION_OPERATIONS_ENABLED: "false" },
    ]) {
      calls.length = 0;
      await assert.rejects(
        bootstrapProduction({ planPath, env: invalid, run }),
      );
      assert.equal(calls.length, 0);
    }
    calls.length = 0;
    await assert.rejects(
      bootstrapProduction({
        planPath,
        env,
        run: async (...args) => {
          const result = await run(...args);
          const value = plan();
          value.steps[0].op = "update";
          return { stdout: JSON.stringify(value) };
        },
      }),
    );
    assert.equal(calls.length, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("first installation retains normal production preflight and isolates application secrets", async () => {
  const workflow = await readFile(
    new URL("../../.github/workflows/deploy-cloudflare.yml", import.meta.url),
    "utf8",
  );
  assert.match(workflow, /initialize_environment:[\s\S]*?default: false/);
  assert.match(workflow, /environment: production-app\n/);
  const initialize = workflow.indexOf(
    "name: Initialize empty production persistence",
  );
  const load = workflow.indexOf("name: Load infrastructure stack outputs");
  const preflight = workflow.indexOf(
    "run: node infra/pulumi/production-preflight.mjs",
  );
  const release = workflow.indexOf(
    "name: Prepare one immutable runtime release",
  );
  assert.ok(
    initialize > 0 &&
      initialize < load &&
      load < preflight &&
      preflight < release,
  );
  assert.match(
    workflow.slice(initialize, load),
    /inputs.initialize_environment/,
  );
  const registry = await readFile(
    new URL(
      "../../.github/workflows/deploy-plugin-registry.yml",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(registry, /environment: production\n/);
});
