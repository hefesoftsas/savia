import { configurePluginEditorPreview } from "../../scripts/configure-plugin-editor-preview.mjs";
import { join, isAbsolute, dirname } from "node:path";
import { mkdir, readFile, writeFile, rm, stat } from "node:fs/promises";
import {
  captureRecovery,
  restoreRecovery,
} from "../../scripts/flows-preview-recovery.mjs";
import {
  captureCanonicalDomainRecovery,
  restoreCanonicalDomainRecovery,
} from "../../scripts/canonical-domain-recovery.mjs";
import { encryptBackup } from "../../scripts/encrypt-flows-backup.mjs";
import { buildSecretUploads } from "../../scripts/upload-cloudflare-secrets.mjs";
import { verifyRuntimeArtifact, publishRuntime } from "./runtime-publisher.mjs";

// Extracted release ordering from deploy-preview/deploy-cloudflare. Executors
// resolve credentials at operation time; command descriptors contain no values.
export function standardReleaseCommands({
  environment,
  provisionedFlows = false,
  runtimeState = "active",
  flowsPolicyGeneration,
  desiredFlows = false,
  configs,
  recoveryDirectory,
  migrationDirectory,
}) {
  if (!["preview", "production"].includes(environment))
    throw new Error("Unknown standard environment");
  if (
    typeof provisionedFlows !== "boolean" ||
    typeof desiredFlows !== "boolean"
  )
    throw new Error("Invalid Flows profile");
  if (!["active", "maintenance"].includes(runtimeState))
    throw new Error("Unknown existing runtime state");
  if (provisionedFlows && !desiredFlows)
    throw new Error("Preserve existing Flows data; pause execution instead");
  if (
    desiredFlows &&
    (!Number.isSafeInteger(flowsPolicyGeneration) || flowsPolicyGeneration < 2)
  )
    throw new Error(
      "A final Flows generation with a separate backup pause generation is required",
    );
  if (!isAbsolute(recoveryDirectory ?? ""))
    throw new Error("Private recovery directory required");
  for (const path of Object.values(configs))
    if (typeof path !== "string" || !isAbsolute(path))
      throw new Error("Prepared configuration path required");
  for (const kind of [
    "api",
    "auth",
    "gateway",
    ...(desiredFlows ? ["flows"] : []),
  ])
    if (!configs[kind]) throw new Error(`Missing prepared ${kind} Worker`);
  const metadataPath = join(
    recoveryDirectory,
    `flows-${environment}-recovery.json`,
  );
  const snapshot = join(recoveryDirectory, "flows-snapshot.json");
  const backupDir = join(recoveryDirectory, "flows-release-backup");
  const archive = `${backupDir}.tar.gz`;
  const encrypted = `${backupDir}.enc`;
  const node = (script, args = []) => ({ kind: "node", script, args });
  const wrangler = (worker, args = []) => ({
    kind: "wrangler",
    worker,
    config: configs[worker],
    args: ["deploy", "--config", configs[worker], ...args],
  });
  const quiesce = [],
    backup = [],
    migrate = [],
    deploy = [],
    verify = [];
  if (environment === "production")
    quiesce.push({
      kind: "canonical-capture",
      metadataPath: join(recoveryDirectory, "canonical-domain-recovery.json"),
    });
  if (provisionedFlows && runtimeState === "active")
    quiesce.push({
      kind: "capture",
      metadataPath,
      configs: { agencies: configs.api, flows: configs.flows },
    });
  if (configs.backupCoordinator) quiesce.push(wrangler("backupCoordinator"));
  quiesce.push(wrangler("api", ["--var", "SAVIA_MAINTENANCE:true"]));
  if (provisionedFlows) {
    quiesce.push(
      wrangler("flows", [
        "--var",
        "SAVIA_FLOWS_EXECUTION_ENABLED:false",
        "--var",
        "SAVIA_FLOWS_MAINTENANCE:true",
        "--var",
        `SAVIA_FLOWS_POLICY_GENERATION:${flowsPolicyGeneration - 1}`,
      ]),
    );
    quiesce.push({ kind: "drain", milliseconds: 45_000 });
    backup.push(
      node("scripts/flows-maintenance.mjs", [
        "--action",
        "backup",
        "--snapshot-file",
        snapshot,
        "--apply",
      ]),
    );
  }
  if (environment === "production") {
    backup.push(
      node("scripts/production-backup.mjs", [
        "--artifact",
        encrypted,
        "--work-root",
        recoveryDirectory,
        ...(provisionedFlows ? ["--flows-snapshot", snapshot] : []),
      ]),
    );
    backup.push(
      node("scripts/production-backup-r2.mjs", [
        "--artifact",
        encrypted,
        "--kind",
        "release",
      ]),
    );
    backup.push({
      kind: "remove-plaintext",
      paths: [backupDir, snapshot, archive],
    });
  } else {
    backup.push(
      node("infra/pulumi/backup.mjs", [
        "--stack",
        environment,
        "--apply",
        "--confirm-quiescent",
        environment,
        ...(provisionedFlows ? ["--flows-snapshot", snapshot] : []),
        "--out-dir",
        backupDir,
      ]),
    );
    backup.push({
      kind: "encrypt",
      inputDirectory: backupDir,
      archive,
      output: encrypted,
    });
  }
  migrate.push(
    node(
      "scripts/apply-d1-migrations.mjs",
      migrationDirectory ? ["--migrations-dir", migrationDirectory] : [],
    ),
  );
  if (desiredFlows)
    migrate.push({
      kind: "wrangler",
      worker: "flows",
      config: configs.flows,
      args: [
        "d1",
        "migrations",
        "apply",
        environment === "preview" ? "savia-flows-preview" : "savia-flows",
        "--remote",
        "--config",
        configs.flows,
      ],
    });
  for (const kind of [
    "mcp",
    "hookExecutor",
    "flows",
    "api",
    "auth",
    "request",
    "connectors",
    "pluginEditor",
    "gateway",
  ])
    if (configs[kind]) {
      deploy.push(wrangler(kind));
      if (kind === "pluginEditor")
        deploy.push({ kind: "plugin-editor-verify" });
    }
  if (configs.gateway)
    verify.push({
      kind: "wrangler",
      worker: "gateway",
      args: [
        "deployments",
        "status",
        "--name",
        environment === "preview" ? "savia-preview" : "savia",
        "--config",
        configs.gateway,
      ],
    });
  if (environment === "preview")
    verify.push(node("scripts/verify-preview-health.mjs"));
  if (desiredFlows) verify.push(node("scripts/verify-flows-preview.mjs"));
  return {
    quiesce,
    backup,
    migrate,
    deploy,
    verify,
    metadataPath,
    encryptedBackup: encrypted,
  };
}

export async function createStandardPublisher(
  inputs,
  {
    env = process.env,
    root,
    client,
    recoveryDirectory,
    run,
    runWrangler,
    sleep = (ms) => new Promise((done) => setTimeout(done, ms)),
    capture = captureRecovery,
    restore = restoreRecovery,
    encrypt = encryptBackup,
  } = {},
) {
  if (
    env.CLOUDFLARE_ACCOUNT_ID !== inputs.accountId ||
    env.SAVIA_DEPLOY_ENVIRONMENT !== inputs.environment
  )
    throw new Error("Standard release account/environment mismatch");
  const artifact = await verifyRuntimeArtifact(inputs);
  const suffix = inputs.environment === "preview" ? "-preview" : "";
  const roleNames = {
    api: `savia-agencies${suffix}`,
    auth: `savia-auth${suffix}`,
    gateway: `savia${suffix}`,
    mcp: `savia-mcp${suffix}`,
    request: `savia-request${suffix}`,
    connectors: `savia-connectors${suffix}`,
    hookExecutor: `savia-hook-executor${suffix}`,
    flows: `savia-flows${suffix}`,
    backupCoordinator: `savia-backup-coordinator${suffix}`,
    pluginEditor: `savia-plugin-editor${suffix}`,
  };
  const configs = {},
    byName = new Map();
  for (const relativePath of artifact.configs) {
    const path = join(inputs.artifactDirectory, relativePath);
    const config = JSON.parse(await readFile(path, "utf8"));
    const role = Object.keys(roleNames).find(
      (key) => roleNames[key] === config.name,
    );
    if (
      !role ||
      !inputs.workers.some((worker) => worker.name === config.name) ||
      byName.has(config.name)
    )
      throw new Error("Unexpected prepared standard Worker target");
    byName.set(config.name, path);
    configs[role] = path;
  }
  if (byName.size !== inputs.workers.length)
    throw new Error("Missing prepared standard Workers");
  const migrationDirectory = join(inputs.artifactDirectory, "migrations");
  if (!(await stat(migrationDirectory)).isDirectory())
    throw new Error("Frozen standard migrations are missing");
  const uploads = buildSecretUploads(inputs.environment, env);
  const backupKey = env.SAVIA_BACKUP_KEY ?? env.SAVIA_FLOWS_BACKUP_KEY;
  if (!/^[a-f\d]{64}$/i.test(backupKey ?? ""))
    throw new Error(
      "A 256-bit backup key is required before standard publication",
    );
  for (const upload of uploads)
    if (!byName.has(upload.worker))
      throw new Error("Secret target missing from release profile");
  const finalFlowsGeneration = configs.flows
    ? Number(
        JSON.parse(await readFile(configs.flows, "utf8")).vars
          ?.SAVIA_FLOWS_POLICY_GENERATION,
      )
    : undefined;
  const plan = standardReleaseCommands({
    environment: inputs.environment,
    provisionedFlows: env.SAVIA_FLOWS_PROVISIONED === "true",
    runtimeState: env.SAVIA_FLOWS_RUNTIME_STATE ?? "active",
    flowsPolicyGeneration: finalFlowsGeneration,
    desiredFlows: !!configs.flows,
    configs,
    recoveryDirectory,
    migrationDirectory,
  });
  const attempted = { agencies: false, flows: false };
  let captured = false,
    canonical;
  async function execute(step) {
    if (step.kind === "capture") {
      await capture({
        env,
        configPaths: step.configs,
        metadataPath: step.metadataPath,
      });
      captured = true;
    } else if (step.kind === "canonical-capture") {
      canonical = await captureCanonicalDomainRecovery({
        accountId: inputs.accountId,
        token: env.CLOUDFLARE_API_TOKEN,
      });
      await writeFile(step.metadataPath, JSON.stringify(canonical), {
        mode: 0o600,
      });
    } else if (step.kind === "plugin-editor-verify") {
      const { subdomain } = await client.api("/workers/subdomain");
      if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(subdomain ?? ""))
        throw new Error("Cannot verify the account plugin editor origin");
      await configurePluginEditorPreview({
        deploymentUrl: `https://savia-plugin-editor-preview.${subdomain}.workers.dev`,
        githubEnvPath: join(recoveryDirectory, "plugin-editor-origin"),
      });
    } else if (step.kind === "drain") await sleep(step.milliseconds);
    else if (step.kind === "node")
      await run("node", [join(root, step.script), ...step.args], {
        cwd: root,
        env: { ...env, CLOUDFLARE_DATABASE_ID: env.SAVIA_DOMAIN_D1_ID },
      });
    else if (step.kind === "wrangler") {
      if (step.worker === "api") attempted.agencies = true;
      if (step.worker === "flows") attempted.flows = true;
      await runWrangler(step.args, { env, cwd: inputs.artifactDirectory });
    } else if (step.kind === "encrypt") {
      await run(
        "tar",
        [
          "-czf",
          step.archive,
          "-C",
          dirname(step.inputDirectory),
          "flows-release-backup",
        ],
        { cwd: root, env },
      );
      try {
        await encrypt(step.archive, step.output, backupKey);
      } finally {
        await rm(step.archive, { force: true });
      }
    } else if (step.kind === "remove-plaintext") {
      for (const path of step.paths)
        await rm(path, { recursive: true, force: true });
    } else throw new Error("Unsupported standard release step");
  }
  const stage = async (steps) => {
    for (const step of steps) await execute(step);
  };
  return {
    publish: async () => {
      await mkdir(recoveryDirectory, { recursive: true, mode: 0o700 });
      return publishRuntime(inputs, {
        quiesce: () => stage(plan.quiesce),
        backup: () => stage(plan.backup),
        migrate: () => stage(plan.migrate),
        secrets: async () => {
          for (const upload of uploads)
            await runWrangler(
              ["secret", "bulk", "--config", byName.get(upload.worker)],
              {
                env,
                cwd: inputs.artifactDirectory,
                input: JSON.stringify(upload.secrets),
              },
            );
        },
        deploy: () => stage(plan.deploy),
        verify: () => stage(plan.verify),
        resume: async () => {},
      });
    },
    recover: async () => {
      if (captured) {
        const result = await restore({
          env,
          metadataPath: plan.metadataPath,
          attemptedWorkers: attempted,
        });
        if (result.failures?.length)
          throw new Error(
            "Flows recovery incomplete; environment remains paused",
          );
      }
      if (canonical)
        await restoreCanonicalDomainRecovery({
          snapshot: canonical,
          accountId: inputs.accountId,
          token: env.CLOUDFLARE_API_TOKEN,
        });
    },
    encryptedBackup: plan.encryptedBackup,
  };
}
