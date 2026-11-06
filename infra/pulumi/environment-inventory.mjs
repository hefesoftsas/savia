import {
  assertAccountId,
  resolveEnvironment,
  resourcePolicy,
  stackKey,
} from "./environments.mjs";
import {
  checkpointOwners,
  sanitizeInventoryResource,
  validateAdoptionManifest,
} from "./environment-manifest.mjs";
export async function readAllPages(fetchPage) {
  const items = [];
  let totalPages = 1;
  for (let page = 1; page <= totalPages; page++) {
    if (page > 10000) throw new Error("Pagination limit exceeded");
    const result = await fetchPage({ page });
    if (
      !Array.isArray(result?.items) ||
      result.page !== page ||
      !Number.isInteger(result.totalPages) ||
      result.totalPages < page ||
      result.totalPages > 10000 ||
      (page > 1 && result.totalPages !== totalPages)
    )
      throw new Error("Invalid pagination page metadata");
    totalPages = result.totalPages;
    items.push(...result.items);
  }
  return items;
}
export async function inventoryEnvironment({
  environment,
  accountId,
  profile = {},
  cloud,
  stacks,
}) {
  assertAccountId(accountId);
  const descriptor = resolveEnvironment(environment);
  const policy = resourcePolicy(environment, profile);
  const [rows, checkpoints] = await Promise.all([
    cloud.listResources(),
    stacks.listCheckpoints(),
  ]);
  if (!Array.isArray(rows)) throw new Error("Invalid cloud resource inventory");
  const owners = checkpointOwners(checkpoints, accountId);
  const resources = [];
  const ownWorkers = new Set(
    rows
      .filter((row) => row.kind === "worker" && policy.matches(row))
      .map((row) => row.name),
  );
  const retentionWorkerNames = new Set();
  const unknownResources = [];
  for (const row of rows) {
    if (row.accountId !== undefined && row.accountId !== accountId)
      throw new Error("Inventory account does not match environment");
    const clean = sanitizeInventoryResource(row);
    clean.ownerStack =
      owners.get(`${row.kind}:${row.cloudId}`) ?? clean.ownerStack;
    if (policy.matches(clean)) {
      resources.push(clean);
      if (row.kind === "worker" && row.hasOpaqueSecrets === true)
        retentionWorkerNames.add(row.name);
      if (row.kind === "durableObject")
        retentionWorkerNames.add(row.parentWorker);
    } else if (clean.parentWorker && ownWorkers.has(clean.parentWorker)) {
      throw new Error(
        "An owned runtime attachment is outside the defined profile",
      );
    } else if (
      typeof row.name === "string" &&
      row.name.startsWith("savia") &&
      !["preview", "production", "shared", "management"].some((id) =>
        resourcePolicy(id).matches(clean),
      )
    )
      unknownResources.push(clean);
  }
  const actualProfile = {
    ...profile,
    retentionWorkerNames: [...retentionWorkerNames].sort(),
    enabledWorkers: resources
      .filter((r) => r.kind === "worker")
      .map((r) => r.name)
      .sort(),
  };
  const result = validateAdoptionManifest(
    {
      version: 1,
      accountId,
      environment,
      project: descriptor.project,
      stack: descriptor.stack,
      profile: actualProfile,
      resources,
    },
    { environment, accountId, checkpoints },
  );
  return Object.freeze({
    ...result,
    unknownResources: Object.freeze(unknownResources),
    status: resources.length
      ? "present"
      : checkpoints.some((cp) => stackKey(cp) === stackKey(descriptor))
        ? "empty"
        : "defined-not-deployed",
  });
}
