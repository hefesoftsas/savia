// Compatibility helpers and guarded delegate to the environment lifecycle.
import { fileURLToPath } from "node:url";
import { normalizeEnvironment, stackProtection } from "./naming.mjs";
import { listR2Objects } from "./backup.mjs";
import { assertAccountId, assertSafeR2Key } from "./naming.mjs";

export function parseDestroyArgs(argv) {
  const stack = flagValue(argv, "--stack");
  const environment = normalizeEnvironment(stack);
  const dryRun = argv.includes("--dry-run");
  const apply = argv.includes("--apply");
  const understood = argv.includes("--i-understand-destroy-production");
  const skipEmptyBucket = argv.includes("--skip-empty-bucket");
  if (!dryRun && !apply) {
    throw new Error(
      "Refusing to destroy without --apply (or use --dry-run to plan)",
    );
  }
  const protection = stackProtection(environment);
  if (protection.protect && !understood) {
    throw new Error(
      `Refusing to destroy production without ${protection.destroyRequires}`,
    );
  }
  return { stack, environment, dryRun, skipEmptyBucket };
}

function flagValue(argv, flag) {
  const index = argv.indexOf(flag);
  if (index === -1 || index + 1 >= argv.length)
    throw new Error(`Missing required flag: ${flag} <preview|production>`);
  const value = argv[index + 1];
  if (typeof value !== "string" || value.startsWith("--") || value === "")
    throw new Error(`Missing required flag: ${flag} <preview|production>`);
  return value;
}

// The confirmation guards use the CLI stack name, but the bucket comes
// from the stack's own config. If a stack named `preview` were ever
// configured with environment=production, emptying "its" bucket would hit
// production data with preview-level confirmation. Refuse the mismatch.
export function assertStackMatches(outputs, plan) {
  if (outputs?.resolvedEnvironment !== plan.environment) {
    throw new Error(
      `Stack ${plan.stack} resolves to environment ${outputs?.resolvedEnvironment}, refusing to destroy`,
    );
  }
  if (outputs?.flowsEnabled === true && !outputs.flowsResources) {
    throw new Error("Enabled Flows stack outputs are missing Flows resources");
  }
  if (outputs?.flowsEnabled === false && outputs.flowsResources !== null) {
    throw new Error("Disabled Flows stack outputs contain Flows resources");
  }
  const bucketNames = r2BucketsForDestroy(outputs);
  if (
    outputs?.stateBackendBucketName &&
    bucketNames.includes(outputs.stateBackendBucketName)
  ) {
    throw new Error(
      "The Pulumi state backend cannot be a data bucket; refusing destroy",
    );
  }
}

export function r2BucketsForDestroy(outputs) {
  const buckets = [outputs?.documentsBucketName];
  if (outputs?.flowsEnabled === true) {
    for (const key of ["resources", "datasets", "inboxes"]) {
      const bucket = outputs.flowsResources?.buckets?.[key];
      if (typeof bucket !== "string" || bucket.trim() === "") {
        throw new Error(
          `Enabled Flows stack outputs are missing the ${key} bucket`,
        );
      }
      buckets.push(bucket);
    }
  }
  if (
    buckets.some((bucket) => typeof bucket !== "string" || bucket.trim() === "")
  ) {
    throw new Error("Stack outputs are missing the documents bucket");
  }
  if (new Set(buckets).size !== buckets.length) {
    throw new Error(
      "Pulumi data bucket names must be unique; refusing destroy",
    );
  }
  return buckets;
}

export function buildPulumiDestroyArgs(stack, _hasStateBackend) {
  normalizeEnvironment(stack);
  return ["destroy", "--stack", stack, "--yes"];
}

// R2 buckets cannot be deleted while they hold objects. Pulumi's destroy
export async function emptyBucketForDestroy({
  bucket,
  accountId,
  token,
  fetchImpl = fetch,
}) {
  if (!bucket || !token)
    throw new Error("bucket and token are required to empty R2");
  assertAccountId(accountId);
  let removed = 0;
  for (let round = 0; round < 10; round++) {
    const objects = await listR2Objects({
      bucket,
      accountId,
      token,
      fetchImpl,
    });
    if (objects.length === 0) return removed;
    for (const object of objects) {
      assertSafeR2Key(object.key);
      const encodedKey = object.key
        .split("/")
        .map(encodeURIComponent)
        .join("/");
      const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${encodeURIComponent(bucket)}/objects/${encodedKey}`;
      const response = await fetchImpl(url, {
        method: "DELETE",
        headers: { authorization: `Bearer ${token}` },
      });
      const payload = await response.json();
      if (response.ok === false || payload.success === false) {
        throw new Error(
          `R2 delete failed (${response.status}): ${JSON.stringify(payload.errors ?? payload).slice(0, 200)}`,
        );
      }
      removed++;
    }
  }
  throw new Error(
    `R2 bucket ${bucket} did not become empty after 10 list/delete rounds`,
  );
}

async function main() {
  const { runLegacyDestroy } = await import("./environment-compat.mjs");
  console.log(
    JSON.stringify(
      await runLegacyDestroy("application", process.argv.slice(2)),
      null,
      2,
    ),
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
