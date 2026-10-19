// Authenticated clients exist only inside provider operations. Only the
// explicitly selected identity metadata below may leave this module as state.
export function createRuntimeCloudClient(
  inputs,
  { env = process.env, fetcher = globalThis.fetch } = {},
) {
  const { accountId, workers } = inputs;
  if (
    !/^[a-f\d]{32}$/.test(accountId) ||
    (env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_ACCOUNT_ID !== accountId)
  )
    throw new Error("Runtime account mismatch");
  if (!env.CLOUDFLARE_API_TOKEN)
    throw new Error("Cloudflare execution-time credential required");
  const token = env.CLOUDFLARE_API_TOKEN;
  async function request(path, { method = "GET", body } = {}) {
    if (!path.startsWith("/") || path.includes(".."))
      throw new Error("Invalid Cloudflare path");
    const response = await fetcher(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}${path}`,
      {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(30_000),
      },
    );
    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new Error(`Cloudflare request failed (${response.status})`);
    }
    if (!response.ok || payload?.success !== true)
      throw new Error(`Cloudflare request failed (${response.status})`);
    return payload;
  }
  const api = async (path, options) => (await request(path, options)).result;
  async function list(path) {
    const all = [],
      seen = new Set();
    for (let page = 1; page <= 10000; page++) {
      const payload = await request(
        `${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`,
      );
      if (!Array.isArray(payload.result))
        throw new Error("Unexpected Cloudflare list response");
      for (const row of payload.result) {
        const id = row.id ?? row.queue_id ?? row.name;
        if (id === undefined || seen.has(id))
          throw new Error("Repeated Cloudflare pagination identity");
        seen.add(id);
        all.push(row);
      }
      if (payload.result_info?.total_pages !== undefined) {
        const info = payload.result_info;
        if (page === 1 && info.total_pages === 0 && payload.result.length === 0)
          return all;
        if (
          info.page !== page ||
          !Number.isInteger(info.total_pages) ||
          info.total_pages < page
        )
          throw new Error("Invalid Cloudflare pagination metadata");
        if (page === info.total_pages) return all;
      } else if (payload.result.length < 100) return all;
    }
    throw new Error("Cloudflare pagination limit exceeded");
  }
  async function readSnapshot() {
    const names = new Set(workers.map((w) => w.name));
    const namespaceIds = (await list("/workers/durable_objects/namespaces"))
      .filter((r) => names.has(r.script))
      .map((r) => ({
        workerName: r.script,
        className: r.class,
        namespaceId: r.id,
      }));
    const workerVersions = [],
      attachments = [];
    for (const worker of workers) {
      const native = await api(`/workers/workers/${worker.cloudId}`);
      if (native.id !== worker.cloudId || native.name !== worker.name)
        throw new Error("Cloudflare Worker identity mismatch");
      const path = `/workers/scripts/${worker.name}`;
      const deployment = await api(`${path}/deployments`);
      const versions = deployment.deployments?.[0]?.versions;
      if (
        !Array.isArray(versions) ||
        versions.length !== 1 ||
        versions[0].percentage !== 100
      )
        throw new Error("Runtime snapshot requires one fully deployed version");
      workerVersions.push({ ...worker, versionId: versions[0].version_id });
      // Settings can contain secrets and variables. Inspect them in memory only;
      // never spread the response into a return value or error message.
      await api(`${path}/settings`);
      const schedule = await api(`${path}/schedules`);
      for (const row of schedule.schedules ?? [])
        attachments.push({
          kind: "cron",
          name: row.cron,
          cloudId: `${worker.name}/${row.cron}`,
          parentWorker: worker.name,
        });
    }
    for (const row of await list("/workers/domains"))
      if (names.has(row.service))
        attachments.push({
          kind: "domain",
          name: row.hostname,
          cloudId: row.id,
          parentWorker: row.service,
        });
    for (const row of await list("/workflows"))
      if (names.has(row.script_name))
        attachments.push({
          kind: "workflow",
          name: row.name,
          cloudId: row.id ?? row.name,
          parentWorker: row.script_name,
        });
    for (const queue of await list("/queues"))
      for (const row of await list(
        `/queues/${queue.queue_id ?? queue.id}/consumers`,
      )) {
        const parentWorker = row.script_name ?? row.script;
        if (names.has(parentWorker))
          attachments.push({
            kind: "consumer",
            name: queue.queue_name ?? queue.name,
            cloudId: row.consumer_id ?? row.id,
            parentWorker,
          });
      }
    return { workerVersions, namespaceIds, attachments };
  }
  async function inspectReferences(manifest) {
    const names = new Set(
      manifest.resources.filter((r) => r.kind === "worker").map((r) => r.name),
    );
    const namespaces = new Map(
      manifest.resources
        .filter((r) => r.kind === "durableObject")
        .map((r) => [r.cloudId, r.parentWorker]),
    );
    const references = [];
    for (const worker of await list("/workers/workers")) {
      const settings = await api(`/workers/scripts/${worker.name}/settings`);
      for (const binding of settings.bindings ?? []) {
        let target;
        if (binding.type === "service" && names.has(binding.service))
          target = binding.service;
        if (binding.type === "durable_object_namespace")
          target =
            namespaces.get(binding.namespace_id) ??
            (names.has(binding.script_name) ? binding.script_name : undefined);
        if (target)
          references.push({ caller: worker.name, target, kind: binding.type });
      }
    }
    return references;
  }
  return { api, list, readSnapshot, inspectReferences };
}
