import test from "node:test";
import assert from "node:assert/strict";
import {
  standardReleaseCommands,
  createStandardPublisher,
} from "./runtime-publisher-standard.mjs";
import { codeOnlyReleaseCommands } from "./runtime-publisher-code-only.mjs";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareRuntimeArtifact } from "./runtime-publisher.mjs";

async function codeOnlyFixture({ targets, runtimeState = "active" }) {
  const root = await mkdtemp(join(tmpdir(), "savia-code-only-release-"));
  const source = join(root, "source");
  await mkdir(join(source, "migrations"), { recursive: true });
  await writeFile(join(source, "migrations", "0000.sql"), "SELECT 1;");
  await writeFile(join(source, "worker.mjs"), "export default {};");
  const revision = "b".repeat(40);
  await writeFile(
    join(source, "release-source.json"),
    JSON.stringify({
      version: 1,
      sourceRevision: revision,
      codeOnly: { base: "a".repeat(40), head: revision, targets },
    }),
  );
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
        names.map((name) => [
          `${name}.json`,
          {
            name,
            main: "worker.mjs",
          },
        ]),
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
    SAVIA_FLOWS_RUNTIME_STATE: runtimeState,
    SAVIA_DOMAIN_D1_ID: "domain-id",
  };
  return { root, inputs, env };
}

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
    ["auth", undefined, "flows", "api", "gateway"],
  );
  assert.equal(plan.deploy[1].script, "scripts/initialize-auth-deployment.mjs");
  assert.deepEqual(plan.deploy[1].args, [
    "--environment",
    "preview",
    "--config",
    "/f/auth.json",
  ]);
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
    assert.ok(
      calls
        .filter(
          (row) => row.binary === "wrangler" && row.args.includes("secret"),
        )
        .every(
          (row) =>
            row.args[0] === "versions" &&
            row.args[1] === "secret" &&
            row.args[2] === "bulk",
        ),
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
    const blocked = await createStandardPublisher(inputs, {
      ...deps,
      run: async (binary, args, options) => {
        calls.push({ binary, args, input: options.input });
        if (args[0]?.endsWith("scripts/initialize-auth-deployment.mjs"))
          throw new Error("Auth preparation failed");
      },
    });
    await assert.rejects(blocked.publish(), /Auth preparation failed/);
    assert.equal(
      calls.some(
        (row) =>
          row.binary === "wrangler" &&
          row.args[0] === "deploy" &&
          row.args.some((arg) => /savia-agencies-preview\.json$/.test(arg)) &&
          !row.args.includes("SAVIA_MAINTENANCE:true"),
      ),
      false,
    );
    assert.equal(
      calls.some(
        (row) =>
          row.binary === "wrangler" &&
          row.args[0] === "deploy" &&
          row.args.some((arg) => /\/savia-preview\.json$/.test(arg)),
      ),
      false,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("code-only publication deploys only scoped preview Workers without stateful release steps", async () => {
  const fixture = await codeOnlyFixture({
    targets: ["api", "auth", "gateway"],
  });
  try {
    const calls = [];
    const publisher = await createStandardPublisher(fixture.inputs, {
      env: fixture.env,
      root: fixture.root,
      client: {
        readSnapshot: async () => ({ maintenanceWorkerNames: [] }),
      },
      recoveryDirectory: join(fixture.root, "recovery"),
      encrypt: async () => {},
      run: async (binary, args) => calls.push({ binary, args }),
      runWrangler: async (args) => calls.push({ binary: "wrangler", args }),
    });

    await publisher.publish();

    const deployments = calls.filter(
      (call) => call.binary === "wrangler" && call.args[0] === "deploy",
    );
    assert.deepEqual(
      deployments.map((call) => call.args[call.args.indexOf("--config") + 1]),
      [
        join(fixture.inputs.artifactDirectory, "savia-auth-preview.json"),
        join(fixture.inputs.artifactDirectory, "savia-agencies-preview.json"),
        join(fixture.inputs.artifactDirectory, "savia-preview.json"),
      ],
    );
    const authDeploy = calls.findIndex(
      (call) =>
        call.binary === "wrangler" &&
        call.args[0] === "deploy" &&
        call.args.some((arg) => arg.endsWith("savia-auth-preview.json")),
    );
    const authInitialize = calls.findIndex(
      (call) =>
        call.binary === "node" &&
        call.args.some((arg) =>
          arg.endsWith("scripts/initialize-auth-deployment.mjs"),
        ),
    );
    const apiDeploy = calls.findIndex(
      (call) =>
        call.binary === "wrangler" &&
        call.args[0] === "deploy" &&
        call.args.some((arg) => arg.endsWith("savia-agencies-preview.json")),
    );
    assert.ok(authDeploy >= 0 && authInitialize > authDeploy);
    assert.ok(authInitialize < apiDeploy);
    assert.ok(
      calls.some(
        (call) =>
          call.binary === "node" &&
          call.args.some((arg) =>
            arg.endsWith("scripts/verify-preview-health.mjs"),
          ),
      ),
    );
    assert.equal(
      calls.some(
        (call) =>
          (call.binary === "node" &&
            /backup|apply-d1-migrations|flows-maintenance/.test(
              call.args.join(" "),
            )) ||
          (call.binary === "wrangler" && call.args.includes("secret")),
      ),
      false,
    );
    const callsBeforeRecovery = calls.length;
    await publisher.recover();
    assert.equal(calls.length, callsBeforeRecovery);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("code-only preflight rejects a maintenance runtime before publication", async () => {
  const fixture = await codeOnlyFixture({ targets: ["api"] });
  try {
    const calls = [];
    await assert.rejects(
      createStandardPublisher(fixture.inputs, {
        env: fixture.env,
        root: fixture.root,
        client: {
          readSnapshot: async () => ({
            maintenanceWorkerNames: ["savia-preview"],
          }),
        },
        recoveryDirectory: join(fixture.root, "recovery"),
        run: async (...args) => calls.push(args),
        runWrangler: async (...args) => calls.push(args),
      }),
      /active runtime/,
    );
    assert.deepEqual(calls, []);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("code-only scopes fail closed on unknown, malformed, production, and paused scopes", () => {
  const revision = "b".repeat(40);
  const configs = { api: "/artifact/api.json" };
  const scoped = (targets = ["api"]) => ({
    version: 1,
    sourceRevision: revision,
    codeOnly: { base: "a".repeat(40), head: revision, targets },
  });
  const plan = (
    releaseSource,
    environment = "preview",
    runtimeState = "active",
  ) =>
    codeOnlyReleaseCommands({
      releaseSource,
      environment,
      runtimeState,
      configs,
    });

  assert.throws(() => plan(scoped(["unknown"])), /scope/);
  assert.throws(() => plan(scoped(["api", "api"])), /scope/);
  assert.throws(
    () =>
      plan({
        ...scoped(),
        codeOnly: { ...scoped().codeOnly, head: "c".repeat(40) },
      }),
    /scope/,
  );
  assert.throws(() => plan(scoped(), "production"), /preview/);
  assert.throws(() => plan(scoped(), "preview", "maintenance"), /active/);
  assert.throws(
    () =>
      codeOnlyReleaseCommands({
        releaseSource: scoped(["gateway"]),
        environment: "preview",
        runtimeState: "active",
        configs,
      }),
    /missing from the frozen artifact/,
  );
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
    ["auth", undefined, "api", "gateway"],
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
