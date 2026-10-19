import { assertBackendConfigured } from "./deploy-stack.mjs";
import {
  previewNames,
  slugifyBranch,
} from "../../scripts/preview-environment.mjs";
import { fileURLToPath } from "node:url";
import { assertAccountId } from "./naming.mjs";
import { assertSafePlan } from "./deploy-stack.mjs";
import { assertDeploymentAccount } from "./outputs.mjs";
import { mkdtemp, rm } from "node:fs/promises";
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

export async function ensureBranchInfrastructure({
  slug,
  env,
  run,
  fetchImpl = fetch,
}) {
  const stack = branchStackName(slug);
  assertBackendConfigured(env);
  if (!env.CLOUDFLARE_ACCOUNT_ID || !env.CLOUDFLARE_API_TOKEN) {
    throw new Error(
      "CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are required",
    );
  }
  assertAccountId(env.CLOUDFLARE_ACCOUNT_ID);
  const options = { cwd: projectRoot, env };
  await run(
    "pulumi",
    ["login", env.PULUMI_BACKEND_URL, "--non-interactive"],
    options,
  );

  // Read the real Cloudflare inventory before creating a stack. Existing
  // exact-name resources are imported into this stack on its first update.
  const [d1Output, buckets] = await Promise.all([
    run(
      "pnpm",
      ["--filter", "@savia/api", "exec", "wrangler", "d1", "list", "--json"],
      options,
    ),
    listR2Buckets({
      accountId: env.CLOUDFLARE_ACCOUNT_ID,
      token: env.CLOUDFLARE_API_TOKEN,
      fetchImpl,
    }),
  ]);
  const names = previewNames(slug);
  const d1 = parseD1List(stdoutOf(d1Output));
  const auth = d1.find((row) => row.name === names.databases.auth);
  const domain = d1.find((row) => row.name === names.databases.domain);
  const bucket = buckets.some((row) => row.name === names.bucket);
  const config = branchStackConfig({
    accountId: env.CLOUDFLARE_ACCOUNT_ID,
    names,
    existing: {
      authD1Id: auth?.uuid,
      domainD1Id: domain?.uuid,
      bucket,
    },
  });

  let initialized = false;
  try {
    await run(
      "pulumi",
      ["stack", "select", stack, "--non-interactive"],
      options,
    );
  } catch (error) {
    if (!isMissingStack(error)) throw error;
    await run(
      "pulumi",
      [
        "stack",
        "init",
        stack,
        "--secrets-provider=passphrase",
        "--non-interactive",
      ],
      options,
    );
    initialized = true;
  }

  if (!initialized) {
    const currentOutput = await run(
      "pulumi",
      ["stack", "output", "--stack", stack, "--json"],
      options,
    );
    const outputs = parseJson(stdoutOf(currentOutput), "Pulumi output");
    if (
      outputs &&
      typeof outputs === "object" &&
      Object.keys(outputs).length === 0
    ) {
      const exported = await run(
        "pulumi",
        ["stack", "export", "--stack", stack],
        options,
      );
      assertEmptyBranchStack(stdoutOf(exported));
      initialized = true;
    } else {
      validateBranchOutputs(outputs, slug, env.CLOUDFLARE_ACCOUNT_ID);
    }
  }

  for (const [key, value] of Object.entries(config)) {
    await run(
      "pulumi",
      [
        "config",
        "set",
        key,
        String(value),
        "--stack",
        stack,
        "--non-interactive",
      ],
      options,
    );
  }
  const planDirectory = await mkdtemp(join(tmpdir(), "savia-branch-plan-"));
  try {
    const planFile = join(planDirectory, "plan.json");
    const preview = await run(
      "pulumi",
      [
        "preview",
        "--stack",
        stack,
        "--refresh",
        "--non-interactive",
        "--save-plan",
        planFile,
        "--json",
      ],
      options,
    );
    assertSafePlan(parseJson(stdoutOf(preview), "Pulumi preview"));
    await run(
      "pulumi",
      [
        "up",
        "--stack",
        stack,
        "--plan",
        planFile,
        "--skip-preview",
        "--yes",
        "--non-interactive",
        "--json",
      ],
      options,
    );
  } finally {
    await rm(planDirectory, { recursive: true, force: true });
  }
  const output = await run(
    "pulumi",
    ["stack", "output", "--stack", stack, "--json"],
    options,
  );
  return {
    stack,
    outputs: validateBranchOutputs(
      parseJson(stdoutOf(output), "Pulumi output"),
      slug,
      env.CLOUDFLARE_ACCOUNT_ID,
    ),
  };
}

export async function selectBranchInfrastructure({ slug, env, run }) {
  const stack = branchStackName(slug);
  assertBackendConfigured(env);
  if (!env.CLOUDFLARE_ACCOUNT_ID || !env.CLOUDFLARE_API_TOKEN) {
    throw new Error(
      "CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are required",
    );
  }
  const options = { cwd: projectRoot, env };
  await run(
    "pulumi",
    ["login", env.PULUMI_BACKEND_URL, "--non-interactive"],
    options,
  );
  await run("pulumi", ["stack", "select", stack, "--non-interactive"], options);
  const output = await run(
    "pulumi",
    ["stack", "output", "--stack", stack, "--json"],
    options,
  );
  return {
    stack,
    outputs: validateBranchOutputs(
      parseJson(stdoutOf(output), "Pulumi output"),
      slug,
      env.CLOUDFLARE_ACCOUNT_ID,
    ),
  };
}
