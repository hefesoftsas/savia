import {
  previewNames,
  slugifyBranch,
} from "../../scripts/preview-environment.mjs";
import { fileURLToPath } from "node:url";
import { assertAccountId } from "./naming.mjs";
import { assertDeploymentAccount } from "./outputs.mjs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const projectRoot = fileURLToPath(
  new URL("./branch-preview/", import.meta.url),
);

export function branchStackName(slug) {
  const validated = slugifyBranch(slug);
  if (validated !== slug) {
    throw new Error(`Branch preview slug must be normalized: ${slug}`);
  }
  return `branch-${validated}`;
}

function parseJson(value, label) {
  try {
    return typeof value === "string" ? JSON.parse(value) : value;
  } catch {
    throw new Error(`Wrangler returned an invalid JSON ${label}`);
  }
}

function rowsFrom(value, keys, label) {
  const parsed = parseJson(value, label);
  const rows = Array.isArray(parsed)
    ? parsed
    : keys.map((key) => parsed?.[key]).find(Array.isArray);
  if (!Array.isArray(rows)) throw new Error(`Wrangler ${label} is malformed`);
  return rows;
}

export function parseD1List(value) {
  const rows = rowsFrom(value, ["d1_databases", "result"], "D1 database list");
  if (
    rows.some(
      (row) =>
        typeof row?.name !== "string" ||
        typeof row?.uuid !== "string" ||
        row.uuid.length === 0,
    )
  ) {
    throw new Error("Wrangler D1 database list contains an invalid resource");
  }
  return rows;
}

export function parseR2BucketList(value) {
  const parsed = parseJson(value, "R2 bucket list");
  const rows = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.buckets)
      ? parsed.buckets
      : Array.isArray(parsed?.result?.buckets)
        ? parsed.result.buckets
        : null;
  if (!Array.isArray(rows)) {
    throw new Error("Cloudflare R2 bucket list is malformed");
  }
  if (rows.some((row) => typeof row?.name !== "string" || !row.name)) {
    throw new Error("Cloudflare R2 bucket list contains an invalid resource");
  }
  return rows;
}

export async function listR2Buckets({ accountId, token, fetchImpl = fetch }) {
  assertAccountId(accountId);
  if (!token) throw new Error("CLOUDFLARE_API_TOKEN is required");
  const buckets = [],
    seenNames = new Set(),
    seenCursors = new Set();
  let cursor;
  for (let page = 1; page <= 1000; page++) {
    const url = new URL(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets`,
    );
    url.searchParams.set("per_page", "1000");
    if (cursor) url.searchParams.set("cursor", cursor);
    const response = await fetchImpl(url.toString(), {
      headers: { authorization: `Bearer ${token}` },
    });
    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new Error("Cloudflare R2 bucket list returned invalid JSON");
    }
    if (response.ok !== true || payload?.success !== true)
      throw new Error(`Cloudflare R2 bucket list failed (${response.status})`);
    for (const bucket of parseR2BucketList(payload)) {
      if (seenNames.has(bucket.name))
        throw new Error("Repeated R2 bucket inventory identity");
      seenNames.add(bucket.name);
      buckets.push(bucket);
    }
    const info = payload.result_info;
    if (
      !info ||
      !Number.isInteger(info.total_count) ||
      info.total_count < 0 ||
      (info.cursor !== undefined &&
        (typeof info.cursor !== "string" || !info.cursor))
    )
      throw new Error("Cloudflare R2 bucket pagination metadata is invalid");
    if (!info.cursor) return buckets;
    if (seenCursors.has(info.cursor))
      throw new Error("Repeated R2 pagination cursor");
    cursor = info.cursor;
    seenCursors.add(cursor);
  }
  throw new Error("Cloudflare R2 bucket listing exceeded 1000 pages");
}

export function branchStackConfig({ accountId, names, existing }) {
  return {
    accountId,
    branchSlug: names.slug,
    authDatabaseName: names.databases.auth,
    domainDatabaseName: names.databases.domain,
    bucketName: names.bucket,
    importAuthD1Id: existing.authD1Id
      ? `${accountId}/${existing.authD1Id}`
      : "",
    importDomainD1Id: existing.domainD1Id
      ? `${accountId}/${existing.domainD1Id}`
      : "",
    importBucketId: existing.bucket
      ? `${accountId}/${names.bucket}/default`
      : "",
  };
}

export function validateBranchOutputs(outputs, slug, runtimeAccountId) {
  const names = previewNames(slug);
  if (outputs?.branchSlug !== slug) {
    throw new Error("Pulumi branch slug does not match the requested branch");
  }
  for (const [key, expected] of [
    ["authDatabaseName", names.databases.auth],
    ["domainDatabaseName", names.databases.domain],
    ["documentsBucketName", names.bucket],
  ]) {
    if (outputs?.[key] !== expected) {
      throw new Error(`Pulumi output ${key} does not match branch ${slug}`);
    }
  }
  for (const key of ["authD1Id", "domainD1Id"]) {
    if (typeof outputs?.[key] !== "string" || outputs[key].trim() === "") {
      throw new Error(`Pulumi output ${key} is required`);
    }
  }
  assertDeploymentAccount(outputs, runtimeAccountId);
  return outputs;
}

function stdoutOf(result) {
  return typeof result === "string" ? result : (result?.stdout ?? "");
}

function assertEmptyBranchStack(stateText) {
  const state = parseJson(stateText, "Pulumi state export");
  if (!Array.isArray(state?.deployment?.resources)) {
    throw new Error("Pulumi branch stack export has no resource list");
  }
  const managed = state.deployment.resources.filter(
    (resource) =>
      !["pulumi:pulumi:Stack", "pulumi:providers:cloudflare"].includes(
        resource.type,
      ),
  );
  if (managed.length > 0) {
    throw new Error(
      "Pulumi branch stack has resources but no validated outputs; refusing update",
    );
  }
}

function isMissingStack(error) {
  return /no stack named|stack .* not found|no stack selected|does not exist/i.test(
    String(error?.stderr ?? error?.stdout ?? error?.message ?? error),
  );
}

async function lifecycleDependencies(options) {
  if (options.dependencies) return options.dependencies;
  const { createEnvironmentDependencies } =
    await import("./environment-operations.mjs");
  return createEnvironmentDependencies({
    env: options.env,
    ...(options.run ? { run: options.run } : {}),
  });
}
async function branchOutputs(
  deps,
  descriptor,
  slug,
  accountId,
  required = true,
) {
  const context = await deps.context(descriptor);
  const outputs = context.checkpoint?.stateExport.deployment.resources.find(
    (row) => row.type === "pulumi:pulumi:Stack",
  )?.outputs;
  if (!outputs || !Object.keys(outputs).length) {
    if (required)
      throw new Error(`No deployed stack named ${descriptor.stack}`);
    return undefined;
  }
  return validateBranchOutputs(outputs, slug, accountId);
}
export async function ensureBranchInfrastructure(options) {
  const { slug, env } = options,
    stack = branchStackName(slug);
  assertAccountId(env.CLOUDFLARE_ACCOUNT_ID);
  const deps = await lifecycleDependencies(options);
  const { resolveEnvironment } = await import("./environments.mjs");
  const { runEnvironmentOperation, parseEnvironmentArgs } =
    await import("./environment.mjs");
  const { inventoryManifest, writePrivateJson } =
    await import("./environment-operations.mjs");
  const descriptor = resolveEnvironment(stack);
  await branchOutputs(deps, descriptor, slug, env.CLOUDFLARE_ACCOUNT_ID, false);
  const inventory = await deps.inventory(stack);
  if (inventory.resources.length) {
    const directory = await mkdtemp(join(tmpdir(), "savia-branch-adoption-"));
    const manifest = join(directory, "manifest.json");
    await writePrivateJson(manifest, inventoryManifest(inventory));
    await runEnvironmentOperation(
      parseEnvironmentArgs([
        "adopt",
        "--environment",
        stack,
        "--manifest",
        manifest,
        "--apply",
      ]),
      deps,
    );
  } else
    await runEnvironmentOperation(
      parseEnvironmentArgs([
        "plan",
        "--environment",
        stack,
        "--provision",
        "--apply",
      ]),
      deps,
    );
  return {
    stack,
    outputs: await branchOutputs(
      deps,
      descriptor,
      slug,
      env.CLOUDFLARE_ACCOUNT_ID,
    ),
  };
}
export async function selectBranchInfrastructure(options) {
  const { slug, env } = options,
    stack = branchStackName(slug);
  assertAccountId(env.CLOUDFLARE_ACCOUNT_ID);
  const deps = await lifecycleDependencies(options);
  const { resolveEnvironment } = await import("./environments.mjs");
  return {
    stack,
    outputs: await branchOutputs(
      deps,
      resolveEnvironment(stack),
      slug,
      env.CLOUDFLARE_ACCOUNT_ID,
    ),
  };
}
