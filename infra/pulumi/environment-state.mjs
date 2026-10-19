import { settledCheckpoint } from "./management-resources.mjs";
import { assertAccountId, stateBackendUrl } from "./naming.mjs";
export function normalizeCheckpoint({
  qualifiedStack,
  backendUrl,
  stateExport,
  accountId,
}) {
  const parts = qualifiedStack.split("/");
  if (
    parts.length !== 3 ||
    parts.some((value) => !value || !/^[\w.-]+$/.test(value))
  )
    throw new Error("Fully qualified checkpoint identity is required");
  const raw = settledCheckpoint(stateExport),
    resources = [],
    accounts = new Set();
  for (const row of raw) {
    const inputAccount = row.inputs?.accountId,
      outputAccount = row.outputs?.accountId;
    if (inputAccount && outputAccount && inputAccount !== outputAccount)
      throw new Error("Checkpoint resource account mismatch");
    if (inputAccount || outputAccount)
      accounts.add(inputAccount ?? outputAccount);
    let kind, name, cloudId;
    if (row.type === "cloudflare:index/worker:Worker") {
      kind = "worker";
      name = row.outputs?.name;
      cloudId = row.id;
    }
    if (row.type === "cloudflare:index/d1Database:D1Database") {
      kind = "d1";
      name = row.outputs?.name;
      cloudId = row.outputs?.uuid ?? row.outputs?.id ?? row.id;
    }
    if (row.type === "cloudflare:index/r2Bucket:R2Bucket") {
      kind = "r2";
      name = row.outputs?.name;
      cloudId = name;
    }
    if (row.type === "cloudflare:index/workersKvNamespace:WorkersKvNamespace") {
      kind = "kv";
      name = row.outputs?.title;
      cloudId = row.id;
    }
    if (row.type === "cloudflare:index/queue:Queue") {
      kind = "queue";
      name = row.outputs?.queueName;
      cloudId = row.id;
    }
    if (row.type === "pulumi-nodejs:dynamic/vectorize:Index") {
      kind = "vectorize";
      name = row.outputs?.name;
      cloudId = name;
    }
    if (kind) {
      if (!name || !cloudId)
        throw new Error("Checkpoint resource identity is incomplete");
      resources.push({ kind, name, cloudId });
    }
    if (row.type === "pulumi-nodejs:dynamic/runtime:RuntimeRelease") {
      for (const item of row.outputs?.namespaceIds ?? [])
        resources.push({
          kind: "durableObject",
          name: `${item.workerName}_${item.className}`,
          cloudId: item.namespaceId,
          parentWorker: item.workerName,
        });
      for (const item of row.outputs?.attachments ?? [])
        resources.push({
          kind: item.kind,
          name: item.name,
          cloudId: item.cloudId,
          parentWorker: item.parentWorker,
        });
    }
  }
  const stackInventory =
    raw.find((row) => row.type === "pulumi:pulumi:Stack")?.outputs
      ?.environmentInventory?.resources ?? [];
  for (const row of stackInventory.filter(
    (row) => row.kind === "durableObject",
  )) {
    if (
      !resources.some(
        (worker) =>
          worker.kind === "worker" && worker.name === row.parentWorker,
      )
    )
      throw new Error("Retained namespace has no managed native host");
    const existing = resources.find(
      (entry) =>
        entry.kind === "durableObject" && entry.cloudId === row.cloudId,
    );
    if (existing) {
      if (
        existing.name !== row.name ||
        existing.parentWorker !== row.parentWorker
      )
        throw new Error("Namespace custody metadata disagrees");
    } else
      resources.push({
        kind: row.kind,
        name: row.name,
        cloudId: row.cloudId,
        parentWorker: row.parentWorker,
      });
  }
  if (accounts.size > 1)
    throw new Error("Checkpoint mixes Cloudflare accounts");
  const actualAccount = accounts.size ? [...accounts][0] : accountId;
  assertAccountId(actualAccount);
  return {
    qualifiedStack,
    project: parts[1],
    stack: parts[2],
    accountId: actualAccount,
    backendUrl,
    resources,
    stateExport,
  };
}
export async function readStateCatalog({ accountId, backends, env, run, cwd }) {
  assertAccountId(accountId);
  if (
    !Array.isArray(backends) ||
    !backends.length ||
    new Set(backends).size !== backends.length ||
    backends.some(
      (url) =>
        !["savia-pulumi-state-preview", "savia-pulumi-state"].some(
          (bucket) => stateBackendUrl(accountId, bucket) === url,
        ),
    )
  )
    throw new Error("Exact known account backend URLs are required");
  const checkpoints = [],
    seen = new Set();
  for (const backendUrl of backends) {
    const options = { cwd, env: { ...env, PULUMI_BACKEND_URL: backendUrl } };
    const summaries = JSON.parse(
      (
        await run(
          "pulumi",
          ["stack", "ls", "--all", "--json", "--fully-qualify-stack-names"],
          options,
        )
      ).stdout,
    );
    if (!Array.isArray(summaries))
      throw new Error("Backend stack inventory is unreadable");
    for (const summary of summaries) {
      if (seen.has(summary.name))
        throw new Error("Duplicate stack locations across known backends");
      seen.add(summary.name);
      const stateExport = JSON.parse(
        (
          await run(
            "pulumi",
            ["stack", "export", "--stack", summary.name],
            options,
          )
        ).stdout,
      );
      checkpoints.push(
        normalizeCheckpoint({
          qualifiedStack: summary.name,
          backendUrl,
          stateExport,
          accountId,
        }),
      );
    }
  }
  return checkpoints;
}
