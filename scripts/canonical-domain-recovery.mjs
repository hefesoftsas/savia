import { chmod, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const API = "https://api.cloudflare.com/client/v4";
const WORKERS = ["savia-auth", "savia-agencies", "savia"];
const TIMEOUT_MS = 20_000;
const SNAPSHOT_VERSION = 1;
const ACCOUNT_ID = /^[a-f\d]{32}$/i;
const UUID =
  /^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;

function requireAccountId(accountId) {
  if (typeof accountId !== "string" || !ACCOUNT_ID.test(accountId))
    throw new Error("A valid Cloudflare account ID is required");
  return accountId;
}

function createCloudflareClient({ accountId, token, fetcher }) {
  const validatedAccountId = requireAccountId(accountId);
  if (typeof token !== "string" || token.length === 0)
    throw new Error("Cloudflare API token is required");

  return async (path, { method = "GET", body } = {}) => {
    let response;
    try {
      response = await fetcher(`${API}/accounts/${validatedAccountId}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body ? { "content-type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      throw new Error(
        `Cloudflare API request failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new Error(`Cloudflare API request failed (${response.status})`);
    }
    if (!response.ok || payload?.success !== true)
      throw new Error(`Cloudflare API request failed (${response.status})`);
    return payload.result;
  };
}

function parseMigrationTag(service, worker) {
  const value = service?.default_environment?.script?.migration_tag;
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || value.trim() === "")
    throw new Error(`Migration tag is invalid for ${worker}`);
  return value;
}

function parseVersions(deployments, worker) {
  const versions = deployments?.[0]?.versions;
  if (!Array.isArray(versions) || versions.length === 0)
    throw new Error(`No active deployment versions found for ${worker}`);
  const parsed = versions.map((entry) => ({
    version_id: entry?.version_id,
    percentage: entry?.percentage,
  }));
  if (
    parsed.some(
      ({ version_id, percentage }) =>
        typeof version_id !== "string" ||
        !UUID.test(version_id) ||
        typeof percentage !== "number" ||
        !Number.isFinite(percentage) ||
        percentage <= 0 ||
        percentage > 100,
    ) ||
    Math.abs(parsed.reduce((sum, entry) => sum + entry.percentage, 0) - 100) >
      1e-9
  ) {
    throw new Error(`Active deployment versions are invalid for ${worker}`);
  }
  return parsed;
}

async function readMigrationTag(api, worker) {
  const service = await api(`/workers/services/${worker}`);
  return parseMigrationTag(service, worker);
}

export async function captureCanonicalDomainRecovery({
  accountId,
  token,
  fetcher = fetch,
  now = () => new Date().toISOString(),
}) {
  const api = createCloudflareClient({ accountId, token, fetcher });
  const workers = [];
  for (const name of WORKERS) {
    const [deployments, service] = await Promise.all([
      api(`/workers/scripts/${name}/deployments`),
      api(`/workers/services/${name}`),
    ]);
    workers.push({
      name,
      migrationTag: parseMigrationTag(service, name),
      versions: parseVersions(deployments?.deployments, name),
    });
  }
  const capturedAt = now();
  if (
    typeof capturedAt !== "string" ||
    !Number.isFinite(Date.parse(capturedAt))
  )
    throw new Error("Recovery snapshot timestamp is invalid");
  return {
    version: SNAPSHOT_VERSION,
    accountId,
    capturedAt,
    workers,
  };
}

function validateSnapshot(snapshot, accountId) {
  if (
    !snapshot ||
    typeof snapshot !== "object" ||
    Array.isArray(snapshot) ||
    snapshot.version !== SNAPSHOT_VERSION ||
    snapshot.accountId !== accountId ||
    typeof snapshot.capturedAt !== "string" ||
    !Number.isFinite(Date.parse(snapshot.capturedAt)) ||
    !Array.isArray(snapshot.workers) ||
    snapshot.workers.length !== WORKERS.length
  ) {
    throw new Error("Recovery snapshot does not match this account or format");
  }
  const names = new Set();
  for (const worker of snapshot.workers) {
    if (
      !worker ||
      typeof worker !== "object" ||
      Object.keys(worker).some(
        (key) => !["name", "migrationTag", "versions"].includes(key),
      ) ||
      !WORKERS.includes(worker.name) ||
      names.has(worker.name)
    ) {
      throw new Error("Recovery snapshot contains an unexpected worker");
    }
    names.add(worker.name);
    if (!(
      worker.migrationTag === null ||
      (typeof worker.migrationTag === "string" &&
        worker.migrationTag.trim() !== "")
    )) {
      throw new Error(`Migration tag is invalid for ${worker.name}`);
    }
    if (
      !Array.isArray(worker.versions) ||
      worker.versions.length === 0 ||
      worker.versions.some(
        (entry) =>
          !entry ||
          typeof entry !== "object" ||
          Object.keys(entry).some(
            (key) => !["version_id", "percentage"].includes(key),
          ),
      )
    ) {
      throw new Error(`Recovery versions are invalid for ${worker.name}`);
    }
    parseVersions([{ versions: worker.versions }], worker.name);
  }
  if (names.size !== WORKERS.length)
    throw new Error("Recovery snapshot contains an unexpected worker set");
  return snapshot.workers;
}

export async function restoreCanonicalDomainRecovery({
  snapshot,
  accountId,
  token,
  fetcher = fetch,
}) {
  const api = createCloudflareClient({ accountId, token, fetcher });
  const workers = validateSnapshot(snapshot, accountId);

  // Check every worker lifecycle before changing any active deployment.
  for (const worker of workers) {
    const currentTag = await readMigrationTag(api, worker.name);
    if (currentTag !== worker.migrationTag)
      throw new Error(
        `Migration tag changed for ${worker.name}; refusing restore`,
      );
  }

  const failures = [];
  const restored = [];
  for (const worker of workers) {
    try {
      await api(`/workers/scripts/${worker.name}/deployments`, {
        method: "POST",
        body: { strategy: "percentage", versions: worker.versions },
      });
      restored.push(worker.name);
    } catch (error) {
      failures.push(
        `${worker.name}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  if (failures.length)
    throw new Error(`Worker recovery failed: ${failures.join("; ")}`);
  return { restored };
}

async function main() {
  const [operation, path, ...extra] = process.argv.slice(2);
  if (
    !["--capture", "--restore"].includes(operation) ||
    !path ||
    extra.length > 0
  ) {
    throw new Error(
      "Use --capture <file> or --restore <file> with Cloudflare account credentials",
    );
  }
  const accountId = requireAccountId(process.env.CLOUDFLARE_ACCOUNT_ID);
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (operation === "--capture") {
    const snapshot = await captureCanonicalDomainRecovery({
      accountId,
      token,
    });
    const data = `${JSON.stringify(snapshot, null, 2)}\n`;
    await writeFile(path, data, { mode: 0o600 });
    await chmod(path, 0o600);
    console.log(`Captured canonical domain Worker recovery state to ${path}.`);
    return;
  }
  let snapshot;
  try {
    snapshot = JSON.parse(await readFile(path, "utf8"));
  } catch {
    throw new Error("Recovery snapshot file is missing or invalid");
  }
  const result = await restoreCanonicalDomainRecovery({
    snapshot,
    accountId,
    token,
  });
  console.log(`Restored ${result.restored.join(", ")} Worker deployments.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
