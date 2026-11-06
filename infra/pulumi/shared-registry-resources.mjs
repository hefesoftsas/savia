import { assertAccountId } from "./naming.mjs";

export const SHARED_REGISTRY_BUCKET = "savia-plugin-registry";
export const SHARED_REGISTRY_WORKER = "savia-plugin-registry";
export const SHARED_REGISTRY_IMPORT_ID = (accountId) =>
  `${assertAccountId(accountId)}/${SHARED_REGISTRY_BUCKET}/default`;

export function sharedRegistryBucketOptions({
  accountId,
  adoptExisting = true,
}) {
  const validAccountId = assertAccountId(accountId);

  return {
    protect: true,
    ...(adoptExisting
      ? { import: SHARED_REGISTRY_IMPORT_ID(validAccountId) }
      : {}),
  };
}

export function validateSharedRegistryOutputs(outputs) {
  assertAccountId(outputs?.cloudflareAccountId);
  if (
    outputs?.environment !== "shared" ||
    outputs?.workerName !== SHARED_REGISTRY_WORKER ||
    outputs?.bucketName !== SHARED_REGISTRY_BUCKET ||
    outputs?.bucketProtected !== true
  ) {
    throw new Error(
      "Shared registry outputs must identify the protected shared savia-plugin-registry bucket and worker",
    );
  }

  return {
    cloudflareAccountId: outputs.cloudflareAccountId,
    environment: outputs.environment,
    workerName: outputs.workerName,
    bucketName: outputs.bucketName,
    bucketProtected: outputs.bucketProtected,
  };
}
