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

// This module is loaded at execution time. Configured clients, environments,
// subprocesses and private recovery paths never enter a serialized provider.
export function createRuntimeOperations(
  inputs,
  {
    env = process.env,
    root = fileURLToPath(new URL("../../", import.meta.url)),
    client = createRuntimeCloudClient(inputs, { env }),
    run = async (executable, args, options) => {
      try {
        return await execFileWithInput(executable, args, options);
      } catch {
        throw new Error(`Runtime helper failed: ${executable}`);
      }
    },
    runWrangler = (args, options = {}) =>
      run(join(root, "apps/api/node_modules/.bin/wrangler"), args, {
        ...options,
        env: options.env ?? env,
      }),
  } = {},
) {
  const environment = resolveEnvironment(inputs.environment);
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
      assertRuntimeBindings(inputs, configs);
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
