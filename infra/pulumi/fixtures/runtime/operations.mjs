import { readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve, join } from "node:path";
import { createRuntimeCloudClient } from "../../runtime-cloud.mjs";
import {
  maintenanceModule,
  maintenanceWorkerConfig,
} from "../../runtime-maintenance.mjs";
import { retireRuntime } from "../../runtime-retirement.mjs";
import { verifyRuntimeArtifact } from "../../runtime-publisher.mjs";

const exec = promisify(execFile);
export function makeFixtureOperations(inputs) {
  const client = createRuntimeCloudClient(inputs);
  const names = inputs.workers.map((w) => w.name);
  const cwd = process.cwd();
  const fixturePrefix = inputs.environment;
  if (
    !/^savia-iac-fixture-[a-z0-9]{5,16}$/.test(fixturePrefix) ||
    names.some(
      (name) =>
        !["gateway", "api", "auth", "coordinator"].some(
          (role) => name === `${fixturePrefix}-${role}`,
        ),
    )
  )
    throw new Error("Fixture operation identity mismatch");
  async function maintenance(name) {
    const role = name.slice(fixturePrefix.length + 1);
    const config = JSON.parse(
      await readFile(join(cwd, `${role}.wrangler.json`), "utf8"),
    );
    if (config.name !== name)
      throw new Error("Fixture manifest identity mismatch");
    await writeFile(
      join(cwd, "maintenance.mjs"),
      maintenanceModule({
        durableObjectClasses: ["FixtureStore"],
        workflowClasses: ["FixtureWorkflow"],
      }),
    );
    const retired = maintenanceWorkerConfig(config);
    await writeFile(
      join(cwd, `${role}.retired.json`),
      JSON.stringify(retired),
      { mode: 0o600 },
    );
    try {
      await exec(
        process.env.SAVIA_FIXTURE_WRANGLER,
        ["deploy", "--config", `${role}.retired.json`],
        { cwd, env: process.env, maxBuffer: 8 * 1024 * 1024 },
      );
    } catch {
      throw new Error(`Fixture maintenance publication failed for ${name}`);
    }
  }
  return {
    readSnapshot: () => client.readSnapshot(),
    verifyArtifact: () => verifyRuntimeArtifact(inputs),
    publish: async () => {
      const artifact = await verifyRuntimeArtifact(inputs);
      const behavior = JSON.parse(
        await readFile(
          join(inputs.artifactDirectory, "release-behavior.json"),
          "utf8",
        ),
      );
      for (const role of ["coordinator", "api", "auth", "gateway"]) {
        const file = `${role}.json`;
        if (!artifact.configs.includes(file))
          throw new Error("Missing frozen fixture config");
        const config = JSON.parse(
          await readFile(join(inputs.artifactDirectory, file), "utf8"),
        );
        if (config.name !== `${fixturePrefix}-${role}`)
          throw new Error("Frozen fixture target mismatch");
        try {
          await exec(
            process.env.SAVIA_FIXTURE_WRANGLER,
            ["deploy", "--config", join(inputs.artifactDirectory, file)],
            {
              cwd: inputs.artifactDirectory,
              env: process.env,
              maxBuffer: 8 * 1024 * 1024,
              timeout: 120_000,
            },
          );
        } catch {
          throw new Error(`Fixture release failed for ${role}`);
        }
        if (behavior.injectFailure)
          throw new Error("Injected managed publication failure");
      }
    },
    recover: async (state) => {
      for (const worker of state.workerVersions)
        await client.api(`/workers/scripts/${worker.name}/deployments`, {
          method: "POST",
          body: {
            strategy: "percentage",
            versions: [{ version_id: worker.versionId, percentage: 100 }],
          },
        });
    },
    pause: async () => {
      for (const name of names) await maintenance(name);
    },
    retire: async (state, options) => {
      const snapshot = await client.readSnapshot();
      const resources = [
        ...inputs.workers.map((w) => ({ kind: "worker", ...w })),
        ...snapshot.namespaceIds.map((r) => ({
          kind: "durableObject",
          name: `${r.workerName}_${r.className}`,
          cloudId: r.namespaceId,
          parentWorker: r.workerName,
        })),
      ];
      const manifest = {
        accountId: inputs.accountId,
        environment: inputs.environment,
        resources,
      };
      return retireRuntime(
        state,
        { ...options, manifest },
        {
          inspectReferences: () => client.inspectReferences(manifest),
          stopProducers: async () => {
            for (const attachment of snapshot.attachments) {
              if (attachment.kind === "cron")
                await client.api(
                  `/workers/scripts/${attachment.parentWorker}/schedules`,
                  { method: "PUT", body: [] },
                );
            }
            for (const queue of await client.list("/queues")) {
              if ((queue.queue_name ?? queue.name) !== `${fixturePrefix}-queue`)
                continue;
              for (const consumer of await client.list(
                `/queues/${queue.queue_id ?? queue.id}/consumers`,
              ))
                await client.api(
                  `/queues/${queue.queue_id ?? queue.id}/consumers/${consumer.consumer_id ?? consumer.id}`,
                  { method: "DELETE" },
                );
            }
          },
          removeIngress: async () => {
            for (const name of names)
              await client.api(`/workers/scripts/${name}/subdomain`, {
                method: "POST",
                body: { enabled: false, previews_enabled: false },
              });
          },
          maintainHosts: async (plan) => {
            for (const name of plan.retainedWorkers) await maintenance(name);
          },
          detachReferences: async (plan) => {
            for (const name of plan.deletedWorkers) await maintenance(name);
          },
          removeWorkflows: async () => {
            for (const workflow of await client.list("/workflows"))
              if (workflow.name === `${fixturePrefix}-workflow`)
                await client.api(`/workflows/${workflow.name}`, {
                  method: "DELETE",
                });
          },
          readNamespaces: async () =>
            (await client.readSnapshot()).namespaceIds,
        },
      );
    },
  };
}

// This factory is serialized by Pulumi. Load operation code from the checked-out
// fixture at execution time; it never captures a configured Cloudflare client.
export async function fixtureDependencies(inputs) {
  const { pathToFileURL } = await import("node:url");
  const operations = await import(
    pathToFileURL(`${process.cwd()}/operations.mjs`).href
  );
  return operations.makeFixtureOperations(inputs);
}
