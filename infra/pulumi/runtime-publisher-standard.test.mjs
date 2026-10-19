import test from "node:test";
import assert from "node:assert/strict";
import {
  standardReleaseCommands,
  createStandardPublisher,
} from "./runtime-publisher-standard.mjs";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareRuntimeArtifact } from "./runtime-publisher.mjs";

test("standard commands preserve coordinator, backup, migration and publication order", () => {
  const plan = standardReleaseCommands({
    environment: "preview",
    provisionedFlows: true,
    desiredFlows: true,
    flowsPolicyGeneration: 100,
    configs: {
      backupCoordinator: "/f/coordinator.json",
      api: "/f/api.json",
      flows: "/f/flows.json",
      auth: "/f/auth.json",
      gateway: "/f/gateway.json",
    },
    recoveryDirectory: "/private/recovery",
  });
  assert.deepEqual(
    plan.quiesce.map((step) => step.kind),
    ["capture", "wrangler", "wrangler", "wrangler", "drain"],
  );
  assert.equal(plan.quiesce[1].config, "/f/coordinator.json");
  assert.equal(plan.quiesce[2].args.includes("SAVIA_MAINTENANCE:true"), true);
  assert.equal(
    plan.quiesce[3].args.includes("SAVIA_FLOWS_EXECUTION_ENABLED:false"),
    true,
  );
  assert.equal(plan.backup[0].script, "scripts/flows-maintenance.mjs");
  assert.equal(plan.backup[1].script, "infra/pulumi/backup.mjs");
  assert.equal(plan.migrate[0].script, "scripts/apply-d1-migrations.mjs");
  assert.deepEqual(
    plan.deploy.map((step) => step.worker),
    ["flows", "api", "auth", "gateway"],
  );
  assert.equal(
    plan.backup.some((step) => step.kind === "encrypt"),
    true,
  );
});

test("the concrete standard publisher uses existing helpers and never places secrets in arguments", async () => {
  const root = await mkdtemp(join(tmpdir(), "savia-standard-release-"));
  try {
    const source = join(root, "source");
    await mkdir(source);
    await mkdir(join(source, "migrations"));
    await writeFile(join(source, "migrations", "0000.sql"), "SELECT 1;");
    await writeFile(join(source, "worker.mjs"), "export default {};");
    const names = [
      "savia-preview",
      "savia-agencies-preview",
      "savia-auth-preview",
      "savia-mcp-preview",
      "savia-request-preview",
      "savia-connectors-preview",
      "savia-hook-executor-preview",
    ];
    const artifact = await prepareRuntimeArtifact({
      environment: "preview",
      release: {
        directory: source,
        configs: Object.fromEntries(
          names.map((name) => [`${name}.json`, { name, main: "worker.mjs" }]),
        ),
      },
      destination: join(root, "artifact"),
    });
    const inputs = {
      ...artifact,
      accountId: "a".repeat(32),
      workers: names.map((name, i) => ({
        name,
        cloudId: String(i).padStart(32, "a"),
      })),
    };
    const env = {
      CLOUDFLARE_ACCOUNT_ID: inputs.accountId,
      SAVIA_DEPLOY_ENVIRONMENT: "preview",
      SAVIA_FLOWS_PROVISIONED: "false",
      SAVIA_DOMAIN_D1_ID: "domain-id",
      SAVIA_BACKUP_KEY: "a".repeat(64),
    };
    for (const key of [
      "BETTER_AUTH_SECRET",
      "SAVIA_MCP_SHARED_SECRET",
      "SAVIA_REQUEST_ENCRYPTION_KEY",
      "EXTENSION_CONNECTIONS_ENCRYPTION_KEY",
      "ASSISTANT_SETTINGS_ENCRYPTION_KEY",
      "STUDIO_INTEGRATION_KEY",
      "NANGO_API_KEY",
    ])
      env[key] = "SECRET_CANARY";
    const calls = [];
    const deps = {
      env,
      root,
      recoveryDirectory: join(root, "recovery"),
      encrypt: async () => {},
      run: async (binary, args, options) =>
        calls.push({ binary, args, input: options.input }),
      runWrangler: async (args, options) =>
        calls.push({ binary: "wrangler", args, input: options.input }),
    };
    const publisher = await createStandardPublisher(inputs, deps);
    await publisher.publish();
    const pause = calls.findIndex((row) =>
      row.args.includes("SAVIA_MAINTENANCE:true"),
    );
    const backup = calls.findIndex((row) =>
      row.args[0]?.endsWith("infra/pulumi/backup.mjs"),
    );
    const migrate = calls.findIndex((row) =>
      row.args[0]?.endsWith("scripts/apply-d1-migrations.mjs"),
    );
    assert.ok(pause >= 0 && backup > pause && migrate > backup);
    assert.ok(calls[migrate].args.includes("--migrations-dir"));
    assert.equal(
      calls.some((row) => row.input?.includes("SECRET_CANARY")),
      true,
    );
    assert.equal(
      JSON.stringify(calls.map((row) => row.args)).includes("SECRET_CANARY"),
      false,
    );
    calls.length = 0;
    await assert.rejects(
      createStandardPublisher(inputs, {
        ...deps,
        env: { ...env, CLOUDFLARE_ACCOUNT_ID: "b".repeat(32) },
      }),
      /mismatch/,
    );
    assert.deepEqual(calls, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a first install skips existing-data capture but keeps the dependency order", () => {
  const plan = standardReleaseCommands({
    environment: "preview",
    provisionedFlows: false,
    desiredFlows: false,
    configs: {
      api: "/f/api.json",
      auth: "/f/auth.json",
      gateway: "/f/gateway.json",
    },
    recoveryDirectory: "/private/recovery",
  });
  assert.deepEqual(
    plan.quiesce.map((step) => step.worker),
    ["api"],
  );
  assert.equal(plan.backup[0].script, "infra/pulumi/backup.mjs");
  assert.equal(plan.backup[0].args.includes("--flows-snapshot"), false);
  assert.deepEqual(
    plan.deploy.map((step) => step.worker),
    ["api", "auth", "gateway"],
  );
  assert.throws(
    () => standardReleaseCommands({ environment: "other", configs: {} }),
    /environment/,
  );
  assert.throws(
    () =>
      standardReleaseCommands({
        environment: "preview",
        provisionedFlows: true,
        desiredFlows: false,
        configs: {},
      }),
    /preserve|Flows/,
  );
});

test("restoring retained maintenance hosts skips active-policy capture but still pauses and backs up all Flows data", () => {
  const plan = standardReleaseCommands({
    environment: "preview",
    provisionedFlows: true,
    desiredFlows: true,
    flowsPolicyGeneration: 100,
    runtimeState: "maintenance",
    configs: {
      api: "/f/api.json",
      auth: "/f/auth.json",
      gateway: "/f/gateway.json",
      flows: "/f/flows.json",
      backupCoordinator: "/f/coordinator.json",
    },
    recoveryDirectory: "/private/recovery",
  });
  assert.equal(
    plan.quiesce.some((step) => step.kind === "capture"),
    false,
  );
  assert.equal(
    plan.quiesce.filter((step) => step.kind === "wrangler").length,
    3,
  );
  assert.ok(
    plan.backup.some((step) => step.script === "scripts/flows-maintenance.mjs"),
  );
  assert.ok(
    plan.backup.some((step) => step.script === "infra/pulumi/backup.mjs"),
  );
});

test("the backup pause consumes a lower generation than the one immutable final release", () => {
  const plan = standardReleaseCommands({
    environment: "preview",
    provisionedFlows: true,
    desiredFlows: true,
    flowsPolicyGeneration: 100,
    configs: {
      api: "/f/api.json",
      auth: "/f/auth.json",
      gateway: "/f/gateway.json",
      flows: "/f/flows.json",
    },
    recoveryDirectory: "/private/recovery",
  });
  const paused = plan.quiesce.find((step) => step.worker === "flows");
  assert.ok(paused.args.includes("SAVIA_FLOWS_POLICY_GENERATION:99"));
});
