import { mkdtemp, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRuntimeCloudClient } from "./runtime-cloud.mjs";
import { bootstrapRuntimeWorkers } from "./runtime-bootstrap.mjs";
import { assertRuntimeBindings } from "./runtime-bindings.mjs";
import { verifyRuntimeArtifact } from "./runtime-publisher.mjs";
import { warmupStandardRuntime } from "./runtime-warmup.mjs";
import { createStandardPublisher } from "./runtime-publisher-standard.mjs";
import { createBranchPublisher } from "./runtime-publisher-prepared-branch.mjs";
import { publishRegistryRuntime } from "./runtime-publisher-registry.mjs";
import { retireCloudRuntime } from "./runtime-retirement-cloud.mjs";
import { resolveEnvironment } from "./environments.mjs";
import { execFileWithInput } from "./runtime-publisher-branch.mjs";
import { runWithCommandDiagnostics } from "./command-diagnostics.mjs";
import { recordRuntimeTiming } from "./runtime-timing.mjs";

const SCRIPT_TIMING_LABELS = new Map([
  ["initialize-auth-deployment.mjs", "auth-init"],
  ["apply-d1-migrations.mjs", "migrations"],
  ["flows-maintenance.mjs", "backup:flows"],
  ["production-backup.mjs", "backup:production"],
  ["production-backup-r2.mjs", "backup:production-r2"],
  ["backup.mjs", "backup:runtime"],
]);

const WORKER_ROLE_ALIASES = new Map([
  ["agencies", "api"],
  ["api", "api"],
  ["auth", "auth"],
  ["flows", "flows"],
  ["mcp", "mcp"],
  ["request", "request"],
  ["preview", "gateway"],
  ["gateway", "gateway"],
  ["legacy", "legacy"],
  ["connectors", "connectors"],
  ["hook-executor", "hook-executor"],
  ["plugin-editor", "plugin-editor"],
  ["backup-coordinator", "backup-coordinator"],
]);

function workerRole(name, environment) {
  if (typeof name !== "string" || !/^[a-z0-9][a-z0-9-]{1,62}$/.test(name))
    return null;
  let role = name.replace(/^savia-/, "");
  const suffix = environment.startsWith("branch-")
    ? `-preview-${environment.slice(7)}`
    : environment === "preview"
      ? "-preview"
      : environment === "production"
        ? ""
        : `-${environment}`;
  if (suffix && role.endsWith(suffix)) role = role.slice(0, -suffix.length);
  return WORKER_ROLE_ALIASES.get(role) ?? null;
}

function runtimeCommandLabel(executable, args, inputs) {
  const base = String(executable).split(/[\\/]/).at(-1);
  if (base === "tar") return "backup:archive";
  if (base === "node") {
    for (const arg of Array.isArray(args) ? args : []) {
      if (typeof arg !== "string") continue;
      const known = SCRIPT_TIMING_LABELS.get(arg.split(/[\\/]/).at(-1));
      if (known) return known;
    }
    return "runtime-command";
  }
  const values = Array.isArray(args) ? args : [];
  if (values[0] === "d1" && values[1] === "migrations")
    return "flows-migrations";
  if (values[0] === "deploy") {
    const configIndex = values.indexOf("--config");
    const configPath = configIndex >= 0 ? values[configIndex + 1] : "";
    const nameFlagIndex = values.indexOf("--name");
    const commandName = nameFlagIndex >= 0 ? values[nameFlagIndex + 1] : "";
    const worker = (inputs.workers ?? []).find(
      (candidate) =>
        candidate.name === commandName ||
        (typeof configPath === "string" &&
          configPath
            .split(/[\\/]/)
            .some(
              (segment) =>
                segment === candidate.name ||
                segment.startsWith(`${candidate.name}.`),
            )),
    );
    const role = worker && workerRole(worker.name, inputs.environment);
    if (role) return `worker-deploy:${role}`;
  }
  if (values[0] === "deployments" && values[1] === "status")
    return "gateway-verify";
  return "wrangler-command";
}

async function timedCommand(directory, label, operation) {
  const started = performance.now();
  let outcome = "success";
  try {
    return await operation();
  } catch (error) {
    outcome = "failure";
    throw error;
  } finally {
    await recordRuntimeTiming(
      directory,
      label,
      Math.max(0, Math.round(performance.now() - started)),
      outcome,
    );
  }
}

// This module is loaded at execution time. Configured clients, environments,
// subprocesses and private recovery paths never enter a serialized provider.
export function createRuntimeOperations(
  inputs,
  {
    env = process.env,
    root = fileURLToPath(new URL("../../", import.meta.url)),
    client = createRuntimeCloudClient(inputs, { env }),
    run: execute = async (executable, args, options) =>
      execFileWithInput(executable, args, options),
    runWrangler: executeWrangler,
  } = {},
) {
  const environment = resolveEnvironment(inputs.environment);
  const run = (executable, args, options) =>
      timedCommand(
        env.SAVIA_RUNTIME_OPERATION_DIRECTORY,
        runtimeCommandLabel(executable, args, inputs),
        () =>
          runWithCommandDiagnostics({
            execute,
            executable,
            args,
            options,
            directory: env.SAVIA_RUNTIME_OPERATION_DIRECTORY,
            operation: "runtime-helper",
            publicError: `Runtime helper failed: ${String(executable).split(/[\\/]/).at(-1)}`,
          }),
      ),
    wranglerPath = join(root, "apps/api/node_modules/.bin/wrangler"),
    runWrangler = (args, options = {}) =>
      timedCommand(
        env.SAVIA_RUNTIME_OPERATION_DIRECTORY,
        runtimeCommandLabel(wranglerPath, args, inputs),
        () =>
          runWithCommandDiagnostics({
            execute: executeWrangler
              ? () => executeWrangler(args, options)
              : execute,
            executable: wranglerPath,
            args,
            options: executeWrangler
              ? options
              : { ...options, env: options.env ?? env },
            directory: env.SAVIA_RUNTIME_OPERATION_DIRECTORY,
            operation: "wrangler",
            publicError: "Runtime helper failed: wrangler",
          }),
      );
  let directory,
    publisher,
    bootstrap = { createdWorkers: [] };
  const work = async () => {
    if (directory) return directory;
    if (env.SAVIA_RUNTIME_OPERATION_DIRECTORY) {
      if (!env.SAVIA_RUNTIME_OPERATION_DIRECTORY.startsWith("/"))
        throw new Error("Private operation directory must be absolute");
      directory = env.SAVIA_RUNTIME_OPERATION_DIRECTORY;
      await mkdir(directory, { recursive: true, mode: 0o700 });
      return directory;
    }
    return (directory = await mkdtemp(
      join(tmpdir(), `savia-runtime-${inputs.environment}-`),
    ));
  };
  const mutationGate = () => {
    if (
      inputs.environment === "production" &&
      (env.PRODUCTION_OPERATIONS_ENABLED !== "true" ||
        env.GITHUB_REF !== "refs/heads/main")
    )
      throw new Error("Production operations are disabled");
    if (env.CLOUDFLARE_ACCOUNT_ID !== inputs.accountId)
      throw new Error("Runtime execution account mismatch");
  };
  return {
    readSnapshot: () =>
      client.readSnapshot({ allowUndeployed: inputs.mode === "adopt" }),
    verifyArtifact: async () => {
      mutationGate();
      const manifest = await verifyRuntimeArtifact(inputs);
      const configs = await Promise.all(
        manifest.configs.map(async (file) =>
          JSON.parse(
            await readFile(join(inputs.artifactDirectory, file), "utf8"),
          ),
        ),
      );
      assertRuntimeBindings(inputs, configs, {
        releaseSource: manifest.releaseSource,
      });
      if (environment.kind === "application")
        publisher = await createStandardPublisher(inputs, {
          env,
          root,
          client,
          recoveryDirectory: join(await work(), "recovery"),
          run,
          runWrangler,
        });
      return manifest;
    },
    bootstrap: async () => {
      mutationGate();
      let retained = false,
        paused = false;
      if (environment.kind === "application") {
        const observation = await client.readSnapshot({
          allowUndeployed: true,
        });
        paused = !!observation.maintenanceWorkerNames?.length;
        for (const worker of observation.workerVersions.filter(
          (row) => row.versionId !== null,
        )) {
          const settings = await client.api(
            `/workers/scripts/${worker.name}/settings`,
          );
          retained ||=
            settings.bindings?.some(
              (binding) =>
                binding.type === "plain_text" &&
                ["SAVIA_RUNTIME_RETIRED", "SAVIA_RUNTIME_WARMUP"].includes(
                  binding.name,
                ) &&
                binding.text === "true",
            ) ?? false;
        }
      }
      bootstrap = await bootstrapRuntimeWorkers(inputs, {
        client,
        directory: await work(),
        runWrangler,
      });
      if (environment.kind === "application") {
        const fresh = bootstrap.createdWorkers.length === inputs.workers.length;
        if (bootstrap.createdWorkers.length && !fresh && !retained)
          throw new Error(
            "Partial standard bootstrap requires explicit lifecycle reconciliation before publication",
          );
        if (fresh || retained)
          await warmupStandardRuntime(inputs, {
            client,
            env,
            root,
            directory: join(await work(), "warmup"),
            run,
            runWrangler,
            createdWorkers: bootstrap.createdWorkers,
            fresh,
          });
        publisher = await createStandardPublisher(inputs, {
          env: {
            ...env,
            SAVIA_FLOWS_RUNTIME_STATE:
              fresh || retained || paused ? "maintenance" : "active",
          },
          root,
          client,
          recoveryDirectory: join(await work(), "recovery"),
          run,
          runWrangler,
        });
      }
      return bootstrap;
    },
    publish: async () => {
      mutationGate();
      if (environment.kind === "application") {
        if (!publisher) throw new Error("Standard release was not preflighted");
        await publisher.publish();
      } else if (environment.kind === "branch") {
        publisher = await createBranchPublisher(inputs, {
          env,
          root,
          client,
          run,
          runWrangler,
          bootstrappedWorkers: bootstrap.createdWorkers,
        });
        await publisher.publish();
      } else if (environment.kind === "shared")
        await publishRegistryRuntime(inputs, { env, runWrangler });
      else throw new Error("Management has no application runtime");
    },
    recover: async (state) => {
      // Existing Flows helpers preserve their pause latch. Restore unrelated
      // Workers explicitly so a partial deployment never masquerades as ready.
      await publisher?.recover?.();
      for (const worker of state.workerVersions ?? []) {
        if (!inputs.workers.some((target) => target.name === worker.name))
          throw new Error("Recovery Worker is outside this environment");
        await client.api(`/workers/scripts/${worker.name}/deployments`, {
          method: "POST",
          body: {
            strategy: "percentage",
            versions: [{ version_id: worker.versionId, percentage: 100 }],
          },
        });
      }
    },
    pause: async () => {
      mutationGate();
      if (environment.kind === "shared")
        throw new Error(
          "Shared registry recovery requires operator intervention",
        );
      await retireCloudRuntime(
        inputs,
        await client.readSnapshot(),
        { deleteData: false },
        { client, directory: join(await work(), "paused"), runWrangler },
      );
    },
    retire: async (state, options) => {
      mutationGate();
      return retireCloudRuntime(inputs, state, options, {
        client,
        directory: join(await work(), "retirement"),
        runWrangler,
      });
    },
  };
}
