import { chmod, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateFlowsWorkerSettings } from "./flows-preview-policy.mjs";

const API = "https://api.cloudflare.com/client/v4";
const workersFor = (environment) => {
  const suffix = environment === "preview" ? "-preview" : "";
  return { agencies: `savia-agencies${suffix}`, flows: `savia-flows${suffix}` };
};
const CONTROL_TABLE = "savia_flows_execution_control";
const TIMEOUT_MS = 30_000;
const METADATA_VERSION = 1;
const UUID =
  /^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;

function requireRecoveryEnvironment(env) {
  const environment = env.SAVIA_DEPLOY_ENVIRONMENT;
  if (!["preview", "production"].includes(environment)) {
    throw new Error("Recovery environment must be preview or production");
  }
  if (env.SAVIA_FLOWS_PROVISIONED !== "true") return null;
  const accountId = env.CLOUDFLARE_ACCOUNT_ID ?? "";
  const token = env.CLOUDFLARE_API_TOKEN;
  if (!/^[a-f\d]{32}$/i.test(accountId) || !token) {
    throw new Error(
      `Cloudflare ${environment} credentials are missing or invalid`,
    );
  }

  let resources;
  try {
    resources = JSON.parse(env.SAVIA_FLOWS_RESOURCES ?? "");
  } catch {
    throw new Error("Authoritative Flows resources are invalid");
  }
  if (
    !resources ||
    resources.workerName !== workersFor(environment).flows ||
    typeof resources.databaseId !== "string" ||
    !UUID.test(resources.databaseId)
  ) {
    throw new Error(
      `Authoritative ${environment} Flows resources do not match ${environment}`,
    );
  }

  return {
    accountId,
    token,
    environment,
    workers: workersFor(environment),
    flowsDatabaseId: resources.databaseId,
  };
}

function parseRenderedConfig(config, worker) {
  let parsed;
  try {
    parsed = JSON.parse(config);
  } catch {
    throw new Error(`Rendered ${worker} Worker config is invalid JSON`);
  }
  const migrations = parsed?.migrations;
  const latest = Array.isArray(migrations) ? migrations.at(-1)?.tag : undefined;
  if (typeof latest !== "string" || !latest) {
    throw new Error(`Rendered ${worker} Worker config has no migration tag`);
  }
  return parsed;
}

function parseVersions(deployments, worker) {
  const versions = deployments?.[0]?.versions;
  if (!Array.isArray(versions) || versions.length === 0) {
    throw new Error(`No active deployment versions found for ${worker}`);
  }
  const result = versions.map((entry) => ({
    version_id: entry?.version_id,
    percentage: entry?.percentage,
  }));
  if (
    result.some(
      ({ version_id, percentage }) =>
        typeof version_id !== "string" ||
        !UUID.test(version_id) ||
        typeof percentage !== "number" ||
        !Number.isFinite(percentage) ||
        percentage <= 0 ||
        percentage > 100,
    ) ||
    Math.abs(result.reduce((sum, entry) => sum + entry.percentage, 0) - 100) >
      1e-9
  ) {
    throw new Error(`Active deployment versions are invalid for ${worker}`);
  }
  return result;
}

function createCloudflareClient({ accountId, token, fetcher }) {
  return async (path, { method = "GET", body } = {}) => {
    const response = await fetcher(`${API}/accounts/${accountId}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new Error(`Cloudflare API request failed (${response.status})`);
    }
    if (!response.ok || payload?.success !== true) {
      throw new Error(`Cloudflare API request failed (${response.status})`);
    }
    if (
      Array.isArray(body?.batch) &&
      (!Array.isArray(payload.result) ||
        payload.result.length !== body.batch.length ||
        payload.result.some((statement) => statement?.success !== true))
    ) {
      throw new Error("Cloudflare D1 batch query failed");
    }
    return payload.result;
  };
}

async function verifyFlowsDatabase(api, databaseId, environment) {
  const database = await api(`/d1/database/${databaseId}`);
  if (database?.name !== workersFor(environment).flows) {
    throw new Error(
      `Flows ${environment} D1 database name does not match ${environment}`,
    );
  }
}

async function readWorkerState(api, name, plannedConfig, environment) {
  const path = `/workers/scripts/${name}`;
  const [deploymentResult, service] = await Promise.all([
    api(`${path}/deployments`),
    api(`/workers/services/${name}`),
  ]);
  const migrationTag = service?.default_environment?.script?.migration_tag;
  if (migrationTag !== plannedConfig.migrationTag) {
    throw new Error(
      `Durable Object migration tag mismatch for ${name}; refusing rollback across lifecycle changes`,
    );
  }
  const state = {
    name,
    migrationTag,
    versions: parseVersions(deploymentResult?.deployments, name),
  };
  if (name === workersFor(environment).flows) {
    const activeVersions = await Promise.all(
      state.versions.map(({ version_id }) =>
        api(`${path}/versions/${version_id}`),
      ),
    );
    const generations = activeVersions.map((version) => {
      const settings = version?.resources;
      const vars = Object.fromEntries(
        (settings?.bindings ?? [])
          .filter((binding) => binding.type === "plain_text")
          .map((binding) => [binding.name, binding.text]),
      );
      if (!["true", "false"].includes(vars.SAVIA_FLOWS_EXECUTION_ENABLED)) {
        throw new Error("Flows execution settings are missing or invalid");
      }
      validateFlowsWorkerSettings(
        settings,
        vars.SAVIA_FLOWS_EXECUTION_ENABLED === "true",
        environment,
      );
      if (vars.SAVIA_FLOWS_MAINTENANCE !== "false") {
        throw new Error(`Flows ${environment} is already in maintenance mode`);
      }
      const generation = Number(vars.SAVIA_FLOWS_POLICY_GENERATION);
      if (!Number.isSafeInteger(generation) || generation <= 0) {
        throw new Error(
          `Flows ${environment} policy generation is missing or invalid`,
        );
      }
      return generation;
    });
    state.policyGeneration = Math.max(...generations);
  }
  return state;
}

export async function captureRecovery({
  env = process.env,
  fetcher = fetch,
  root = process.cwd(),
  configPaths = {
    agencies: resolve(
      root,
      `apps/api/wrangler.${env.SAVIA_DEPLOY_ENVIRONMENT ?? "preview"}.jsonc`,
    ),
    flows: resolve(
      root,
      `apps/flows/api/wrangler.${env.SAVIA_DEPLOY_ENVIRONMENT ?? "preview"}.jsonc`,
    ),
  },
  metadataPath = resolve(env.RUNNER_TEMP ?? ".", "flows-preview-recovery.json"),
  now = Date.now,
} = {}) {
  if (env.SAVIA_FLOWS_PROVISIONED !== "true") return { skipped: true };
  const target = requireRecoveryEnvironment(env);
  const [agenciesConfig, flowsConfig] = await Promise.all([
    readFile(configPaths.agencies, "utf8"),
    readFile(configPaths.flows, "utf8"),
  ]);
  const plannedTags = {
    agencies: parseRenderedConfig(agenciesConfig, target.workers.agencies),
    flows: parseRenderedConfig(flowsConfig, target.workers.flows),
  };
  const renderedFlowsPolicyGeneration = Number(
    JSON.parse(flowsConfig).vars?.SAVIA_FLOWS_POLICY_GENERATION,
  );
  if (
    !Number.isSafeInteger(renderedFlowsPolicyGeneration) ||
    renderedFlowsPolicyGeneration <= 0
  ) {
    throw new Error("Rendered Flows policy generation is missing or invalid");
  }
  const api = createCloudflareClient({ ...target, fetcher });
  await verifyFlowsDatabase(api, target.flowsDatabaseId, target.environment);
  const workers = {};
  for (const key of ["agencies", "flows"]) {
    workers[key] = await readWorkerState(
      api,
      target.workers[key],
      {
        migrationTag: plannedTags[key].migrations.at(-1).tag,
      },
      target.environment,
    );
  }
  if (renderedFlowsPolicyGeneration <= workers.flows.policyGeneration) {
    throw new Error(
      "Rendered Flows policy generation must be newer than the current Flows policy generation",
    );
  }

  const metadata = {
    version: METADATA_VERSION,
    environment: target.environment,
    capturedAt: now(),
    accountId: target.accountId,
    flowsDatabaseId: target.flowsDatabaseId,
    renderedFlowsPolicyGeneration,
    workers,
  };
  await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, {
    mode: 0o600,
  });
  await chmod(metadataPath, 0o600);
  return { skipped: false, metadataPath };
}

function validateMetadata(metadata, target) {
  if (
    metadata?.version !== METADATA_VERSION ||
    metadata.environment !== target.environment ||
    metadata.accountId !== target.accountId ||
    metadata.flowsDatabaseId !== target.flowsDatabaseId
  ) {
    throw new Error(
      `Recovery metadata does not match this ${target.environment} account and Flows database`,
    );
  }
  if (
    !Number.isSafeInteger(metadata.renderedFlowsPolicyGeneration) ||
    metadata.renderedFlowsPolicyGeneration <= 0 ||
    !Number.isSafeInteger(metadata.workers?.flows?.policyGeneration) ||
    metadata.workers.flows.policyGeneration <= 0
  ) {
    throw new Error(
      "Recovery metadata contains an invalid Flows policy generation",
    );
  }
  for (const key of ["agencies", "flows"]) {
    const worker = metadata.workers?.[key];
    if (worker?.name !== target.workers[key]) {
      throw new Error(`Recovery metadata contains an unexpected ${key} Worker`);
    }
    worker.versions = parseVersions(
      [{ versions: worker.versions }],
      target.workers[key],
    );
  }
}

function pauseLatchBatch(now, generationFloor) {
  if (
    !Number.isSafeInteger(now) ||
    now <= 0 ||
    !Number.isSafeInteger(generationFloor) ||
    generationFloor <= 0
  ) {
    throw new Error("Flows pause latch generations are invalid");
  }
  return {
    batch: [
      {
        sql: `CREATE TABLE IF NOT EXISTS ${CONTROL_TABLE} (
          id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
          paused INTEGER NOT NULL CHECK (paused IN (0, 1)),
          updated_at INTEGER NOT NULL,
          generation INTEGER NOT NULL DEFAULT 0
        )`,
        params: [],
      },
      {
        sql: `INSERT INTO ${CONTROL_TABLE} (id, paused, updated_at, generation)
          SELECT 1, 1, CAST(? AS INTEGER), MAX(CAST(? AS INTEGER), CAST(? AS INTEGER), COALESCE((SELECT generation FROM ${CONTROL_TABLE} WHERE id = 1), 0) + 1)
          WHERE true
          ON CONFLICT(id) DO UPDATE SET paused=1, updated_at=excluded.updated_at,
            generation=MAX(${CONTROL_TABLE}.generation + 1, excluded.generation)`,
        params: [String(now), String(now), String(generationFloor)],
      },
      {
        sql: `SELECT paused, generation FROM ${CONTROL_TABLE} WHERE id = 1`,
        params: [],
      },
    ],
  };
}

export async function restoreRecovery({
  env = process.env,
  fetcher = fetch,
  metadataPath = resolve(env.RUNNER_TEMP ?? ".", "flows-preview-recovery.json"),
  attemptedWorkers = { agencies: false, flows: false },
  now = Date.now,
} = {}) {
  if (env.SAVIA_FLOWS_PROVISIONED !== "true") return { skipped: true };
  const target = requireRecoveryEnvironment(env);
  const attempted = {
    agencies: attemptedWorkers.agencies === true,
    flows: attemptedWorkers.flows === true,
  };
  if (!attempted.agencies && !attempted.flows) return { skipped: true };

  let metadata;
  try {
    metadata = JSON.parse(await readFile(metadataPath, "utf8"));
  } catch {
    throw new Error("Recovery metadata is missing or invalid");
  }
  validateMetadata(metadata, target);
  const api = createCloudflareClient({ ...target, fetcher });
  await verifyFlowsDatabase(api, target.flowsDatabaseId, target.environment);
  const result = {
    skipped: false,
    restored: { agencies: false, flows: false },
    failures: [],
  };

  let flowLatchReady = !attempted.flows;
  if (attempted.flows) {
    try {
      const batchResults = await api(
        `/d1/database/${target.flowsDatabaseId}/query`,
        {
          method: "POST",
          body: pauseLatchBatch(
            now(),
            Math.max(
              metadata.renderedFlowsPolicyGeneration,
              metadata.workers.flows.policyGeneration,
            ) + 1,
          ),
        },
      );
      const verificationRows = batchResults[2]?.results;
      const verification = Array.isArray(verificationRows)
        ? verificationRows[0]
        : undefined;
      const knownGeneration = Math.max(
        metadata.renderedFlowsPolicyGeneration,
        metadata.workers.flows.policyGeneration,
      );
      if (
        verification?.paused !== 1 ||
        !Number.isSafeInteger(verification.generation) ||
        verification.generation <= knownGeneration
      ) {
        throw new Error("Flows pause latch verification failed");
      }
      flowLatchReady = true;
    } catch {
      result.failures.push(
        "Flows execution pause latch failed; Flows rollback was withheld",
      );
    }
  }

  if (attempted.agencies) {
    try {
      await api(`/workers/scripts/${target.workers.agencies}/deployments`, {
        method: "POST",
        body: {
          strategy: "percentage",
          versions: metadata.workers.agencies.versions,
        },
      });
      result.restored.agencies = true;
    } catch {
      result.failures.push(
        "Savia API deployment recovery was rejected; migration or resource lifecycle may prevent rollback, and no force bypass was used",
      );
    }
  }

  if (attempted.flows && flowLatchReady) {
    try {
      await api(`/workers/scripts/${target.workers.flows}/deployments`, {
        method: "POST",
        body: {
          strategy: "percentage",
          versions: metadata.workers.flows.versions,
        },
      });
      result.restored.flows = true;
    } catch {
      result.failures.push(
        "Flows Worker deployment recovery was rejected; migration or resource lifecycle may prevent rollback, and no force bypass was used",
      );
    }
  }

  return result;
}

export function parseArgs(argv) {
  const flags = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!flag.startsWith("--") || flags.has(flag)) {
      throw new Error("Invalid recovery arguments");
    }
    if (
      ![
        "--action",
        "--environment",
        "--metadata",
        "--apply",
        "--attempted-agencies",
        "--attempted-flows",
      ].includes(flag)
    ) {
      throw new Error(`Unknown recovery option: ${flag}`);
    }
    if (flag === "--apply") {
      flags.set(flag, true);
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Missing value for ${flag}`);
    }
    flags.set(flag, value);
    index += 1;
  }
  if (
    !["capture", "restore"].includes(flags.get("--action")) ||
    !["preview", "production"].includes(flags.get("--environment")) ||
    flags.get("--apply") !== true ||
    !flags.get("--metadata")
  ) {
    throw new Error(
      "Use --action capture|restore --environment preview|production --metadata <path> --apply",
    );
  }
  return {
    action: flags.get("--action"),
    environment: flags.get("--environment"),
    metadataPath: flags.get("--metadata"),
    attemptedWorkers: {
      agencies: flags.get("--attempted-agencies") === "true",
      flows: flags.get("--attempted-flows") === "true",
    },
  };
}

export function assertRecoveryCliEnvironment(args, env = process.env) {
  if (args.environment !== env.SAVIA_DEPLOY_ENVIRONMENT) {
    throw new Error(
      `Recovery --environment ${args.environment} does not match SAVIA_DEPLOY_ENVIRONMENT ${env.SAVIA_DEPLOY_ENVIRONMENT ?? "(unset)"}`,
    );
  }
}

async function main() {
  let environment;
  try {
    const args = parseArgs(process.argv.slice(2));
    environment = args.environment;
    assertRecoveryCliEnvironment(args);
    const result =
      args.action === "capture"
        ? await captureRecovery(args)
        : await restoreRecovery(args);
    if (result.skipped) {
      console.log(
        `Flows ${environment} recovery skipped because Flows is not provisioned or no pause was attempted.`,
      );
      return;
    }
    if (args.action === "capture") {
      console.log(
        `Captured ${environment} Worker deployment recovery metadata.`,
      );
      return;
    }
    for (const failure of result.failures) {
      console.error(`::error::${failure}`);
    }
    if (result.failures.length) {
      throw new AggregateError(
        result.failures.map((failure) => new Error(failure)),
        `${environment} recovery reported failures`,
      );
    }
    console.log(`${environment} Worker recovery actions completed.`);
  } catch (error) {
    console.error(
      `::error::${error instanceof Error ? error.message : `${environment ?? "Flows"} recovery failed`}`,
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
