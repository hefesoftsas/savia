import { createRuntimeCloudClient } from "./runtime-cloud.mjs";
import { listR2Buckets } from "./branch-preview-resources.mjs";
import { assertAccountId } from "./naming.mjs";
export async function listEnvironmentCloudResources({
  accountId,
  env = process.env,
  makeClient = createRuntimeCloudClient,
  buckets = () => listR2Buckets({ accountId, token: env.CLOUDFLARE_API_TOKEN }),
}) {
  assertAccountId(accountId);
  const base = makeClient(
    { accountId, workers: [], environment: "inventory" },
    { env },
  );
  const [native, d1, r2, kv, queues, vectorize] = await Promise.all([
    base.list("/workers/workers"),
    base.list("/d1/database"),
    buckets(),
    base.list("/storage/kv/namespaces"),
    base.list("/queues"),
    base.list("/vectorize/v2/indexes"),
  ]);
  const workers = native
    .filter((row) => /^savia(?:-|$)/.test(row.name))
    .map((row) => ({ name: row.name, cloudId: row.id }));
  const client = makeClient(
    { accountId, workers, environment: "inventory" },
    { env },
  );
  const [snapshot, routes] = await Promise.all([
    client.readSnapshot({ allowUndeployed: true }),
    client.readRoutes(),
  ]);
  const rows = [];
  for (const worker of workers) {
    const settings = snapshot.undeployedWorkerNames?.includes(worker.name)
      ? { bindings: [] }
      : await client.api(`/workers/scripts/${worker.name}/settings`);
    const dependencies = [
      ...new Set(
        (settings.bindings ?? []).flatMap((binding) =>
          binding.type === "service"
            ? [binding.service]
            : binding.type === "durable_object_namespace" &&
                binding.script_name &&
                binding.script_name !== worker.name
              ? [binding.script_name]
              : [],
        ),
      ),
    ].sort();
    rows.push({
      kind: "worker",
      ...worker,
      accountId,
      versionId:
        snapshot.workerVersions.find((row) => row.name === worker.name)
          ?.versionId ?? undefined,
      hasOpaqueSecrets: snapshot.secretWorkerNames.includes(worker.name),
      dependencies,
    });
  }
  rows.push(
    ...snapshot.namespaceIds.map((row) => ({
      kind: "durableObject",
      name: `${row.workerName}_${row.className}`,
      cloudId: row.namespaceId,
      parentWorker: row.workerName,
      accountId,
    })),
    ...snapshot.attachments.map((row) => ({ ...row, accountId })),
    ...routes.map((row) => ({ ...row, accountId })),
    ...d1.map((row) => ({
      kind: "d1",
      name: row.name,
      cloudId: row.uuid ?? row.id,
      accountId,
    })),
    ...r2.map((row) => ({
      kind: "r2",
      name: row.name,
      cloudId: row.name,
      accountId,
    })),
    ...kv.map((row) => ({
      kind: "kv",
      name: row.title,
      cloudId: row.id,
      accountId,
    })),
    ...queues.map((row) => ({
      kind: "queue",
      name: row.queue_name ?? row.name,
      cloudId: row.queue_id ?? row.id,
      accountId,
    })),
    ...vectorize.map((row) => ({
      kind: "vectorize",
      name: row.name,
      cloudId: row.name,
      accountId,
    })),
  );
  return rows;
}
