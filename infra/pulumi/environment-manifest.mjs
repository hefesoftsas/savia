import { createHash } from "node:crypto";
import {
  assertAccountId,
  resolveEnvironment,
  resourcePolicy,
  stackKey,
} from "./environments.mjs";
const rowKeys = new Set([
  "kind",
  "name",
  "cloudId",
  "ownerStack",
  "parentWorker",
  "versionId",
  "namespaceIds",
  "dependencies",
]);
const topKeys = new Set([
  "version",
  "accountId",
  "environment",
  "project",
  "stack",
  "profile",
  "resources",
  "createdAt",
]);
function onlyKeys(value, keys, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((k) => !keys.has(k))
  )
    throw new Error(`Invalid ${label} fields; metadata only`);
}
export function sanitizeInventoryResource(row) {
  const result = {
    kind: row.kind,
    name: row.name,
    cloudId: row.cloudId,
    ownerStack: row.ownerStack ?? null,
    parentWorker: row.parentWorker ?? null,
  };
  for (const k of ["versionId", "namespaceIds", "dependencies"])
    if (row[k] !== undefined) result[k] = structuredClone(row[k]);
  return result;
}
function validProfile(profile, policy) {
  onlyKeys(
    profile,
    new Set([
      "enabledWorkers",
      "flowsEnabled",
      "searchEnabled",
      "tenantSubdomains",
      "databaseNames",
      "retentionWorkerNames",
    ]),
    "profile",
  );
  for (const key of ["flowsEnabled", "searchEnabled"])
    if (profile[key] !== undefined && typeof profile[key] !== "boolean")
      throw new Error(`Invalid ${key}`);
  if (
    profile.enabledWorkers !== undefined &&
    (!Array.isArray(profile.enabledWorkers) ||
      new Set(profile.enabledWorkers).size !== profile.enabledWorkers.length ||
      profile.enabledWorkers.some((n) => !policy.rules.get("worker")?.has(n)))
  )
    throw new Error("Invalid enabled Worker profile");
  if (profile.databaseNames)
    onlyKeys(
      profile.databaseNames,
      new Set(["auth", "domain"]),
      "database names",
    );
  if (
    profile.retentionWorkerNames !== undefined &&
    (!Array.isArray(profile.retentionWorkerNames) ||
      new Set(profile.retentionWorkerNames).size !==
        profile.retentionWorkerNames.length ||
      profile.retentionWorkerNames.some(
        (name) =>
          typeof name !== "string" || !policy.rules.get("worker")?.has(name),
      ))
  )
    throw new Error("Invalid retention Worker profile");
}
function validId(row) {
  if (typeof row.cloudId !== "string" || !row.cloudId) return false;
  if (["worker", "kv", "queue", "durableObject", "route"].includes(row.kind))
    return /^[a-f\d]{32}$/i.test(row.cloudId);
  if (row.kind === "domain") return /^[a-f\d]{40}$/i.test(row.cloudId);
  if (row.kind === "d1")
    return /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(row.cloudId);
  if (["r2", "vectorize"].includes(row.kind)) return row.cloudId === row.name;
  if (row.kind === "workflow")
    return (
      row.cloudId === row.name ||
      /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(row.cloudId)
    );
  if (["cron", "consumer"].includes(row.kind))
    return (
      row.cloudId === `${row.parentWorker}/${row.name}` ||
      /^[a-f\d]{32}$/i.test(row.cloudId)
    );
  return false;
}
function freeze(value) {
  if (value && typeof value === "object") {
    for (const v of Object.values(value)) freeze(v);
    Object.freeze(value);
  }
  return value;
}
export function checkpointOwners(checkpoints, accountId) {
  if (!Array.isArray(checkpoints))
    throw new Error("All inspected checkpoints are required");
  const result = new Map();
  for (const checkpoint of checkpoints) {
    assertAccountId(checkpoint.accountId);
    if (checkpoint.accountId !== accountId) continue;
    if (
      !Array.isArray(checkpoint.resources) ||
      !checkpoint.project ||
      !checkpoint.stack
    )
      throw new Error("Invalid checkpoint ownership metadata");
    for (const row of checkpoint.resources) {
      const key = `${row.kind}:${row.cloudId}`;
      if (result.has(key))
        throw new Error(`Duplicate checkpoint ownership for ${row.name}`);
      result.set(key, stackKey(checkpoint));
    }
  }
  return result;
}
export function validateAdoptionManifest(
  manifest,
  { environment, accountId, checkpoints },
) {
  assertAccountId(accountId);
  onlyKeys(manifest, topKeys, "manifest");
  const descriptor = resolveEnvironment(environment);
  if (
    manifest.version !== 1 ||
    manifest.accountId !== accountId ||
    manifest.environment !== environment ||
    manifest.project !== descriptor.project ||
    manifest.stack !== descriptor.stack
  )
    throw new Error("Manifest account/environment/stack mismatch");
  const profile = manifest.profile ?? {};
  const policy = resourcePolicy(environment, profile);
  validProfile(profile, policy);
  if (!Array.isArray(manifest.resources))
    throw new Error("Manifest resources are required");
  const owners = checkpointOwners(checkpoints, accountId);
  const identities = new Set(),
    names = new Set();
  const own = stackKey(descriptor);
  for (const row of manifest.resources) {
    onlyKeys(row, rowKeys, "resource");
    if (
      row.parentWorker &&
      ![
        "domain",
        "route",
        "workflow",
        "cron",
        "consumer",
        "durableObject",
      ].includes(row.kind)
    )
      throw new Error("Only runtime attachments may have a parent Worker");
    if (!policy.matches(row) || !validId(row))
      throw new Error(
        `Resource identity is outside environment: ${row.kind}/${row.name}`,
      );
    const key = `${row.kind}:${row.cloudId}`,
      name =
        row.kind === "cron"
          ? `${row.kind}:${row.parentWorker}:${row.name}`
          : `${row.kind}:${row.name}`;
    if (identities.has(key) || names.has(name))
      throw new Error("Duplicate resource identity");
    identities.add(key);
    names.add(name);
    if (
      (row.ownerStack && stackKey(row.ownerStack) !== own) ||
      (owners.has(key) && owners.get(key) !== own)
    )
      throw new Error(
        `Resource is already owned by another stack: ${row.name}`,
      );
    if (
      row.dependencies !== undefined &&
      (!Array.isArray(row.dependencies) ||
        row.dependencies.some(
          (n) =>
            typeof n !== "string" ||
            (!policy.rules.get("worker")?.has(n) &&
              n !== "savia-plugin-registry"),
        ))
    )
      throw new Error("Worker dependency crosses environment ownership");
    if (
      row.namespaceIds !== undefined &&
      (!Array.isArray(row.namespaceIds) ||
        row.namespaceIds.some((n) => !/^[a-f\d]{32}$/i.test(n)))
    )
      throw new Error("Invalid namespace identities");
    if (
      row.versionId !== undefined &&
      (typeof row.versionId !== "string" || !row.versionId)
    )
      throw new Error("Invalid live version identity");
  }
  const workerNames = new Set(
    manifest.resources.filter((r) => r.kind === "worker").map((r) => r.name),
  );
  if (profile.retentionWorkerNames?.some((name) => !workerNames.has(name)))
    throw new Error("Retained Worker is absent from the manifest");
  for (const row of manifest.resources) {
    if (row.parentWorker && !workerNames.has(row.parentWorker))
      throw new Error(
        "Attached resource parent is missing from adoption manifest",
      );
    if (
      row.dependencies?.some(
        (n) => !workerNames.has(n) && n !== "savia-plugin-registry",
      )
    )
      throw new Error("Internal dependency is missing from adoption manifest");
  }
  if (
    profile.enabledWorkers &&
    JSON.stringify([...workerNames].sort()) !==
      JSON.stringify([...profile.enabledWorkers].sort())
  )
    throw new Error("Enabled Worker profile does not match live manifest");
  return freeze(structuredClone({ ...manifest, profile }));
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, canonical(value[k])]),
    );
  return value;
}
export function adoptionManifestHash(manifest) {
  return createHash("sha256")
    .update(JSON.stringify(canonical(manifest)))
    .digest("hex");
}
export function assertAdoptionPlan(plan, manifest) {
  if (!Array.isArray(plan?.steps))
    throw new Error("Detailed Pulumi plan steps are required");
  for (const step of plan.steps) {
    if (
      step.op === "update" &&
      step.type === "pulumi:pulumi:Stack" &&
      step.urn ===
        `urn:pulumi:${manifest.stack}::${manifest.project}::pulumi:pulumi:Stack::${manifest.project}-${manifest.stack}`
    )
      continue;
    if (["same", "read", "refresh", "read-discard"].includes(step.op)) continue;
    if (
      step.op === "create" &&
      [
        "pulumi:pulumi:Stack",
        "pulumi:providers:cloudflare",
        "pulumi:providers:pulumi-nodejs",
      ].includes(step.type)
    )
      continue;
    if (
      step.op === "create" &&
      step.type === "savia:runtime:RuntimeRelease" &&
      step.mode === "adopt" &&
      step.environment === manifest.environment &&
      step.accountId === manifest.accountId &&
      step.manifestHash === adoptionManifestHash(manifest)
    )
      continue;
    if (
      step.op === "create" &&
      step.type === "savia:vectorize:Index" &&
      step.adoptExisting === true &&
      step.deleteData === false &&
      step.accountId === manifest.accountId &&
      step.environment === manifest.environment &&
      step.dimensions === 1024 &&
      step.metric === "cosine" &&
      manifest.resources.some(
        (row) =>
          row.kind === "vectorize" &&
          row.name === step.name &&
          row.cloudId === step.cloudId,
      )
    )
      continue;
    if (
      step.op === "import" &&
      step.accountId === manifest.accountId &&
      manifest.resources.some(
        (r) =>
          r.kind === step.kind &&
          r.name === step.name &&
          r.cloudId === step.cloudId,
      )
    )
      continue;
    throw new Error(
      `Refusing unreviewed or mutating adoption step: ${step.op}/${step.name ?? step.type}`,
    );
  }
  return true;
}
