import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { resolveEnvironment } from "./environments.mjs";
import { validateAdoptionManifest } from "./environment-manifest.mjs";
import { maintenanceModule } from "./runtime-maintenance.mjs";
import { retireRuntime } from "./runtime-retirement.mjs";

// Retirement uses live metadata. Expired release directories are never read.
export async function retireCloudRuntime(
  inputs,
  state,
  { deleteData = false } = {},
  {
    client,
    directory,
    runWrangler,
    sleep = (ms) => new Promise((done) => setTimeout(done, ms)),
  },
) {
  const environment = resolveEnvironment(inputs.environment);
  if (!["application", "branch"].includes(environment.kind))
    throw new Error("Shared and management environments are protected");
  const live = await client.readSnapshot({ allowUndeployed: true });
  for (const old of state.namespaceIds ?? [])
    if (
      !live.namespaceIds.some(
        (row) =>
          row.namespaceId === old.namespaceId &&
          row.workerName === old.workerName &&
          row.className === old.className,
      )
    )
      throw new Error("Runtime namespace identity changed before retirement");
  const dataResources = (inputs.adoptionManifest?.resources ?? []).filter(
    (row) => ["d1", "r2", "kv", "queue", "vectorize"].includes(row.kind),
  );
  const retainedSecrets = [
    ...new Set([
      ...(live.secretWorkerNames ?? []),
      ...(state.retentionWorkerNames ?? []),
      ...(inputs.adoptionManifest?.profile?.retentionWorkerNames ?? []),
    ]),
  ].sort();
  const manifest = validateAdoptionManifest(
    {
      version: 1,
      accountId: inputs.accountId,
      environment: inputs.environment,
      project: environment.project,
      stack: environment.stack,
      profile: {
        ...(inputs.adoptionManifest?.profile ?? {}),
        enabledWorkers: inputs.workers.map((row) => row.name).sort(),
        retentionWorkerNames: retainedSecrets,
      },
      resources: [
        ...inputs.workers.map((row) => ({ kind: "worker", ...row })),
        ...dataResources,
        ...live.attachments,
        ...live.namespaceIds.map((row) => ({
          kind: "durableObject",
          name: `${row.workerName}_${row.className}`,
          cloudId: row.namespaceId,
          parentWorker: row.workerName,
        })),
      ],
    },
    {
      environment: inputs.environment,
      accountId: inputs.accountId,
      checkpoints: [],
    },
  );
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const configs = new Map();
  // Prepare every target/class before stopping any producer or ingress.
  for (const worker of inputs.workers) {
    if (live.undeployedWorkerNames?.includes(worker.name)) {
      if (live.namespaceIds.some((row) => row.workerName === worker.name))
        throw new Error(
          "Undeployed host has namespace data; reconcile its lifecycle before retirement",
        );
      continue;
    }
    const settings = await client.api(
      `/workers/scripts/${worker.name}/settings`,
    );
    const service = await client.api(`/workers/services/${worker.name}`);
    const tag = service.default_environment?.script?.migration_tag;
    if (tag !== undefined && tag !== null && typeof tag !== "string")
      throw new Error("Unsupported Worker migration metadata");
    const owned = live.namespaceIds.filter(
      (row) => row.workerName === worker.name,
    );
    const workflows = [];
    for (const row of live.attachments.filter(
      (row) => row.kind === "workflow" && row.parentWorker === worker.name,
    )) {
      const workflow = await client.api(`/workflows/${row.name}`);
      if (typeof workflow.class_name !== "string")
        throw new Error("Unsupported Workflow class metadata");
      workflows.push(workflow.class_name);
    }
    const code = maintenanceModule({
      durableObjectClasses: owned.map((row) => row.className),
      workflowClasses: [...new Set(workflows)],
    });
    const main = `${worker.name}.maintenance.mjs`;
    await writeFile(join(directory, main), code, { mode: 0o600 });
    const bindings = (settings.bindings ?? [])
      .filter(
        (binding) =>
          binding.type === "durable_object_namespace" &&
          owned.some((row) => row.namespaceId === binding.namespace_id),
      )
      .map((binding) => ({
        name: binding.name,
        class_name: owned.find(
          (row) => row.namespaceId === binding.namespace_id,
        ).className,
      }));
    if (
      owned.some(
        (row) =>
          !bindings.some((binding) => binding.class_name === row.className),
      )
    )
      throw new Error("Owned namespace binding is missing");
    const config = {
      name: worker.name,
      main,
      compatibility_date: settings.compatibility_date ?? "2026-10-01",
      compatibility_flags: settings.compatibility_flags ?? [],
      vars: { SAVIA_RUNTIME_RETIRED: "true" },
      workers_dev: false,
      preview_urls: false,
      routes: [],
      services: [],
      workflows: [],
      triggers: { crons: [] },
      queues: { consumers: [], producers: [] },
      durable_objects: { bindings },
      ...(tag ? { migrations: [{ tag }] } : {}),
    };
    const path = join(directory, `${worker.name}.maintenance.json`);
    await writeFile(path, JSON.stringify(config), { mode: 0o600 });
    configs.set(worker.name, path);
  }
  const publish = async (names) => {
    for (const name of names)
      if (!live.undeployedWorkerNames?.includes(name))
        await runWrangler(["deploy", "--config", configs.get(name)], {
          cwd: directory,
        });
  };
  return retireRuntime(
    { ...state, retentionWorkerNames: retainedSecrets },
    { manifest, deleteData },
    {
      inspectReferences: () => client.inspectReferences(manifest),
      stopProducers: async () => {
        for (const worker of inputs.workers)
          if (!live.undeployedWorkerNames?.includes(worker.name))
            await client.api(`/workers/scripts/${worker.name}/schedules`, {
              method: "PUT",
              body: [],
            });
        const consumers = live.attachments.filter(
          (row) => row.kind === "consumer",
        );
        if (consumers.length)
          for (const queue of await client.list("/queues")) {
            for (const consumer of consumers.filter(
              (row) => row.name === (queue.queue_name ?? queue.name),
            ))
              await client.api(
                `/queues/${queue.queue_id ?? queue.id}/consumers/${consumer.cloudId}`,
                { method: "DELETE" },
              );
          }
      },
      removeIngress: async () => {
        for (const worker of inputs.workers)
          if (!live.undeployedWorkerNames?.includes(worker.name))
            await client.api(`/workers/scripts/${worker.name}/subdomain`, {
              method: "POST",
              body: { enabled: false, previews_enabled: false },
            });
        for (const row of live.attachments) {
          if (row.kind === "domain")
            await client.api(`/workers/domains/${row.cloudId}`, {
              method: "DELETE",
            });
          if (row.kind === "route")
            await client.zoneApi(`/workers/routes/${row.cloudId}`, {
              method: "DELETE",
            });
        }
        await sleep(45_000);
      },
      maintainHosts: (plan) => publish(plan.retainedWorkers),
      detachReferences: (plan) => publish(plan.deletedWorkers),
      removeWorkflows: async () => {
        for (const row of live.attachments.filter(
          (row) => row.kind === "workflow",
        ))
          await client.api(`/workflows/${row.name}`, { method: "DELETE" });
      },
      readNamespaces: async () =>
        (await client.readSnapshot({ allowUndeployed: true })).namespaceIds,
    },
  );
}
