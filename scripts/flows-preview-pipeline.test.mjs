import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { standardReleaseCommands } from "../infra/pulumi/runtime-publisher-standard.mjs";
import { publishRuntime } from "../infra/pulumi/runtime-publisher.mjs";
import { flowsWorkerConfig } from "../infra/pulumi/flows-worker-config.mjs";
test("preview activation is explicit and has bounded compute settings", async () => {
  const yaml = await readFile(
    new URL("../infra/pulumi/Pulumi.preview.yaml", import.meta.url),
    "utf8",
  );
  assert.match(yaml, /savia-cloudflare:flowsEnabled: true/);
  assert.match(yaml, /savia-cloudflare:flowsExecutionEnabled: true/);
  const flow = flowsWorkerConfig(
    { buckets: {} },
    "https://savia-preview.hefesoft.com",
    "preview",
  );
  assert.equal(flow.vars.CLOUDFLARE_ENV, "preview");
  assert.equal(flow.vars.SAVIA_FLOWS_EXECUTION_ENABLED, "false");
  assert.equal(flow.vars.SAVIA_FLOWS_MAINTENANCE, "false");
  assert.equal(flow.limits.cpu_ms, 30000);
  assert.equal(flow.queues.consumers[0].max_concurrency, 1);
  assert.equal(flow.queues.consumers[0].max_retries, 5);
});
test("managed release stops on a failed backup and publishes the executor before Flows", async () => {
  const configs = Object.fromEntries(
    [
      "api",
      "auth",
      "gateway",
      "flows",
      "hookExecutor",
      "backupCoordinator",
    ].map((name) => [name, `/frozen/${name}.json`]),
  );
  const commands = standardReleaseCommands({
    environment: "preview",
    provisionedFlows: true,
    desiredFlows: true,
    flowsPolicyGeneration: 4,
    configs,
    recoveryDirectory: "/private/recovery",
  });
  assert.equal(commands.quiesce[0].kind, "capture");
  assert.ok(
    commands.quiesce.some((step) =>
      step.args?.includes("SAVIA_MAINTENANCE:true"),
    ),
  );
  assert.ok(
    commands.quiesce.some((step) =>
      step.args?.includes("SAVIA_FLOWS_EXECUTION_ENABLED:false"),
    ),
  );
  assert.deepEqual(
    commands.backup.map((step) => step.script ?? step.kind),
    ["scripts/flows-maintenance.mjs", "infra/pulumi/backup.mjs", "encrypt"],
  );
  assert.deepEqual(
    commands.deploy.map((step) => step.worker ?? step.script),
    [
      "auth",
      "scripts/initialize-auth-deployment.mjs",
      "hookExecutor",
      "flows",
      "api",
      "gateway",
    ],
  );
  assert.ok(
    commands.verify.some(
      (step) => step.script === "scripts/verify-flows-preview.mjs",
    ),
  );
  const calls = [];
  const operations = Object.fromEntries(
    [
      "quiesce",
      "backup",
      "migrate",
      "secrets",
      "deploy",
      "verify",
      "resume",
    ].map((stage) => [
      stage,
      async () => {
        calls.push(stage);
        if (stage === "backup") throw new Error("backup unavailable");
      },
    ]),
  );
  await assert.rejects(publishRuntime({}, operations), /backup unavailable/);
  assert.deepEqual(calls, ["quiesce", "backup"]);
});

test("preview delegates publication and recovery to the managed runtime and retains encrypted evidence on failure", async () => {
  const pipeline = await readFile(
    new URL("../.github/workflows/deploy-preview.yml", import.meta.url),
    "utf8",
  );
  assert.match(pipeline, /environment\.mjs plan --environment preview/);
  assert.match(pipeline, /environment\.mjs apply --environment preview/);
  assert.doesNotMatch(
    pipeline,
    /wrangler deploy|command: deploy|flows-preview-recovery\.mjs --action restore|continue-on-error:/,
  );
  const archive = pipeline
    .split("- name: Retain encrypted managed recovery archive")[1]
    .split("- name:")[0];
  assert.match(archive, /if: \$\{\{ always\(\) \}\}/);
  assert.match(
    archive,
    /path: \$\{\{ runner\.temp \}\}\/savia-runtime\/recovery\/flows-release-backup\.enc/,
  );
});

test("managed preview publication receives credentials for private authenticated snapshots", async () => {
  const pipeline = await readFile(
    new URL("../.github/workflows/deploy-preview.yml", import.meta.url),
    "utf8",
  );
  const apply = pipeline
    .split("- name: Apply the exact managed runtime plan")[1]
    .split("- name:")[0];
  for (const key of [
    "CLOUDFLARE_ACCOUNT_ID",
    "CLOUDFLARE_API_TOKEN",
    "SAVIA_FLOWS_BRIDGE_SECRET",
    "SAVIA_BACKUP_CONTROL_SECRET",
    "SAVIA_FLOWS_BACKUP_KEY",
  ])
    assert.ok(apply.includes(key + ": ${{ secrets." + key + " }}"), key);
});

test("accepted standard runtime transactions defer cancellation until Pulumi finishes or recovers", async () => {
  for (const file of ["deploy-preview", "deploy-cloudflare"]) {
    const pipeline = await readFile(
      new URL(`../.github/workflows/${file}.yml`, import.meta.url),
      "utf8",
    );
    const deploy = pipeline.split("\n  deploy:\n")[1];
    assert.ok(deploy, file);
    assert.match(deploy.split("    steps:")[0], /always\(\)/);
    const plan = deploy
      .split("- name: Review the saved managed runtime plan")[1]
      .split("- name:")[0];
    assert.match(plan, /id: runtime_plan/);
    assert.match(plan, /if: \$\{\{ success\(\) && !cancelled\(\) \}\}/);
    const preparation = deploy
      .split("- name: Prepare one immutable runtime release")[1]
      .split("- name:")[0];
    assert.match(preparation, /if: \$\{\{ success\(\) && !cancelled\(\) \}\}/);
    const apply = deploy
      .split("- name: Apply the exact managed runtime plan")[1]
      .split("- name:")[0];
    assert.match(
      apply,
      /if: \$\{\{ always\(\) && !failure\(\) && steps\.runtime_plan\.outcome == 'success' \}\}/,
    );
    const content = deploy
      .split("- name: Deploy release plugin ZIPs to all workspaces")[1]
      .split("- name:")[0];
    assert.match(content, /if: \$\{\{ success\(\) && !cancelled\(\) \}\}/);
  }
});
