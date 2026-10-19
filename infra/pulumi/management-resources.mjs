import { assertAccountId, stateBackendUrl } from "./naming.mjs";
export function managementBackendName(name) {
  if (!["savia-pulumi-state-preview", "savia-pulumi-state"].includes(name))
    throw new Error("Invalid management state backend bucket");
  return name;
}
export function managementBucketDefinitions({ accountId, backendBuckets }) {
  assertAccountId(accountId);
  if (!Array.isArray(backendBuckets) || backendBuckets.length !== 1)
    throw new Error("Exactly one existing backend bucket is required");
  return backendBuckets.map((name) => ({
    logicalName: "state-backend",
    args: { accountId, name: managementBackendName(name) },
    options: { protect: true },
  }));
}
export function settledCheckpoint(checkpoint) {
  const deployment = checkpoint?.deployment;
  if (!Array.isArray(deployment?.resources))
    throw new Error("Readable checkpoint resources are required");
  if (
    (deployment.pending_operations ?? checkpoint.pendingOperations ?? [])
      .length ||
    deployment.resources.some(
      (row) => row.delete || row.deleted || row.pendingReplacement,
    )
  )
    throw new Error("Checkpoint has pending operations or replacements");
  return deployment.resources;
}
export function validateManagementOutputs(value, { accountId, backendUrl }) {
  assertAccountId(accountId);
  if (value?.accountId !== accountId || value.protected !== true)
    throw new Error("Management account/protection is unverified");
  managementBucketDefinitions({
    accountId,
    backendBuckets: value.backendBuckets,
  });
  const resources = settledCheckpoint(value.checkpoint);
  const managed = resources.filter(
    (row) =>
      row.type !== "pulumi:pulumi:Stack" &&
      !row.type?.startsWith("pulumi:providers:"),
  );
  if (managed.length !== value.backendBuckets.length)
    throw new Error(
      "Management checkpoint must own only the protected backend",
    );
  for (const bucket of value.backendBuckets) {
    const row = managed.find(
      (row) =>
        row.type === "cloudflare:index/r2Bucket:R2Bucket" &&
        row.outputs?.name === bucket,
    );
    if (
      !row ||
      row.protect !== true ||
      row.outputs?.accountId !== accountId ||
      row.inputs?.accountId !== accountId ||
      row.inputs?.name !== bucket ||
      !row.urn?.startsWith("urn:pulumi:management::savia-management::") ||
      !row.urn.endsWith("::state-backend") ||
      ![bucket, `${accountId}/${bucket}/default`].includes(row.id)
    )
      throw new Error("Management backend identity/protection mismatch");
  }
  if (
    !value.backendBuckets.some(
      (name) => stateBackendUrl(accountId, name) === backendUrl,
    )
  )
    throw new Error("Management backend URL/account mismatch");
  return {
    accountId,
    backendBuckets: [...value.backendBuckets],
    protected: true,
  };
}
