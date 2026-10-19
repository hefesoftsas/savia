// Authenticated clients exist only inside provider operations. Only the
// explicitly selected identity metadata below may leave this module as state.
export function createRuntimeCloudClient(
  inputs,
  {
    env = process.env,
    fetcher = globalThis.fetch,
    sleep = (ms) => new Promise((done) => setTimeout(done, ms)),
  } = {},
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
  async function request(
    path,
    { method = "GET", body } = {},
    attempt = 0,
    global = false,
  ) {
    if (!path.startsWith("/") || path.includes(".."))
      throw new Error("Invalid Cloudflare path");
    if (global && !/^\/zones(?:\?|\/|$)/.test(path))
      throw new Error("Only zone-scoped global API calls are supported");
    const response = await fetcher(
      `https://api.cloudflare.com/client/v4${global ? "" : `/accounts/${accountId}`}${path}`,
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
    if (response.status === 429 && attempt < 3) {
      const header = response.headers.get("retry-after");
      const seconds = header === null ? 2 ** attempt : Number(header);
      if (!Number.isFinite(seconds) || seconds < 0 || seconds > 300)
        throw new Error("Cloudflare rate limit requires a later retry");
      await response.body?.cancel();
      for (
        let remaining = Math.max(1000, Math.ceil(seconds * 1000));
        remaining > 0;
        remaining -= 30_000
      )
        await sleep(Math.min(remaining, 30_000));
      return request(path, { method, body }, attempt + 1, global);
    }
    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new Error(
        `Cloudflare ${method} ${path} failed (${response.status})`,
      );
    }
    if (!response.ok || payload?.success !== true)
      throw new Error(
        `Cloudflare ${method} ${path} failed (${response.status})`,
      );
    return payload;
  }
  const api = async (path, options) => (await request(path, options)).result;
  const globalApi = async (path, options) =>
    (await request(path, options, 0, true)).result;
  async function list(path, global = false) {
    const all = [],
      seen = new Set();
    for (let page = 1; page <= 10000; page++) {
      const payload = await request(
        `${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`,
        {},
        0,
        global,
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
  const zoneId = env.CLOUDFLARE_ZONE_ID ?? "b3255bc65c2bc8cb8edf33a34e08b255";
  async function zoneApi(path, options) {
    if (!/^[a-f\d]{32}$/.test(zoneId))
      throw new Error("Invalid deployment zone identity");
    const zone = await globalApi(`/zones/${zoneId}`);
    if (zone.account?.id !== accountId || zone.name !== "hefesoft.com")
      throw new Error("Deployment zone account mismatch");
    return globalApi(`/zones/${zoneId}${path}`, options);
  }
  async function readRoutes() {
    const routes = await zoneApi("/workers/routes");
    if (!Array.isArray(routes))
      throw new Error("Unexpected Worker route inventory");
    return routes
      .filter((route) => workers.some((worker) => worker.name === route.script))
      .map((route) => ({
        kind: "route",
        name: route.pattern,
        cloudId: route.id,
        parentWorker: route.script,
      }));
  }
  async function readSnapshot({ allowUndeployed = false } = {}) {
    const names = new Set(workers.map((w) => w.name));
    const namespaceIds = (await list("/workers/durable_objects/namespaces"))
      .filter((r) => names.has(r.script))
      .map((r) => ({
        workerName: r.script,
        className: r.class,
        namespaceId: r.id,
      }));
    const secretWorkerNames = [],
      undeployedWorkerNames = [],
      maintenanceWorkerNames = [];
    const workerVersions = [],
      attachments = [];
    for (const worker of workers) {
      const native = await api(`/workers/workers/${worker.cloudId}`);
      if (native.id !== worker.cloudId || native.name !== worker.name)
        throw new Error("Cloudflare Worker identity mismatch");
      if (native.deployed_on === null) {
        if (!allowUndeployed)
          throw new Error(
            "Runtime identity is undeployed; bootstrap is required",
          );
        workerVersions.push({ ...worker, versionId: null });
        undeployedWorkerNames.push(worker.name);
        continue;
      }
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
      const settings = await api(`${path}/settings`);
      if (settings.bindings?.some((binding) => binding.type === "secret_text"))
        secretWorkerNames.push(worker.name);
      const flags = Object.fromEntries(
        (settings.bindings ?? [])
          .filter((binding) => binding.type === "plain_text")
          .map((binding) => [binding.name, binding.text]),
      );
      let maintenance = [
        "SAVIA_RUNTIME_BOOTSTRAP",
        "SAVIA_RUNTIME_RETIRED",
        "SAVIA_RUNTIME_WARMUP",
        "SAVIA_MAINTENANCE",
        "SAVIA_FLOWS_MAINTENANCE",
      ].some((key) => flags[key] === "true");
      if (
        /^savia-flows(?:-preview)?$/.test(worker.name) &&
        flags.SAVIA_FLOWS_EXECUTION_ENABLED === "true" &&
        !maintenance
      ) {
        const database = settings.bindings?.find(
          (binding) => binding.type === "d1" && binding.name === "DB",
        );
        if (!database || !/^[a-f\d-]{36}$/.test(database.id))
          throw new Error("Flows policy database identity is unavailable");
        const query = async (sql) => {
          const result = await api(`/d1/database/${database.id}/query`, {
            method: "POST",
            body: { sql },
          });
          if (
            !Array.isArray(result) ||
            result.length !== 1 ||
            result[0].success !== true ||
            !Array.isArray(result[0].results)
          )
            throw new Error("Cannot observe Flows execution policy");
          return result[0].results;
        };
        const tables = await query(
          "SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'savia_flows_execution_control'",
        );
        if (tables.length) {
          const rows = await query(
            "SELECT paused, generation FROM savia_flows_execution_control WHERE id = 1",
          );
          if (rows.some((row) => row.paused !== 0 && row.paused !== 1))
            throw new Error("Invalid Flows execution policy");
          maintenance = rows.some((row) => row.paused === 1);
        }
      }
      if (maintenance) maintenanceWorkerNames.push(worker.name);
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
    if (
      ["preview", "production"].includes(inputs.environment) ||
      inputs.environment?.startsWith("branch-")
    )
      attachments.push(...(await readRoutes()));
    return {
      workerVersions,
      namespaceIds,
      attachments,
      secretWorkerNames,
      undeployedWorkerNames,
      maintenanceWorkerNames,
    };
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
    const dataTargets = new Map();
    for (const row of manifest.resources)
      for (const id of [row.cloudId, row.name])
        dataTargets.set(`${row.kind}:${id}`, row.name);
    for (const worker of await list("/workers/workers")) {
      if (worker.deployed_on === null) continue;
      const settings = await api(`/workers/scripts/${worker.name}/settings`);
      for (const binding of settings.bindings ?? []) {
        let target;
        if (binding.type === "service" && names.has(binding.service))
          target = binding.service;
        if (binding.type === "durable_object_namespace")
          target =
            namespaces.get(binding.namespace_id) ??
            (names.has(binding.script_name) ? binding.script_name : undefined);
        const dataBindings = {
          d1: ["d1", binding.id],
          r2_bucket: ["r2", binding.bucket_name],
          kv_namespace: ["kv", binding.namespace_id],
          queue: ["queue", binding.queue_id ?? binding.queue_name],
          vectorize: ["vectorize", binding.index_name],
        };
        if (dataBindings[binding.type]) {
          const [kind, id] = dataBindings[binding.type];
          target = dataTargets.get(`${kind}:${id}`);
        }
        if (target)
          references.push({ caller: worker.name, target, kind: binding.type });
      }
    }
    return references;
  }
  return { api, list, readSnapshot, inspectReferences, zoneApi, readRoutes };
}
