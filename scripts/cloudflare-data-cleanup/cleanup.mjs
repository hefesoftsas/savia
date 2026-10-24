const TERMINAL_RUNS = "status IN ('succeeded', 'failed', 'expired')";
const REPORT_CHUNK_KINDS = "kind IN ('report', 'chunk')";
const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_MAX_BATCHES = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

const AGENCY_TARGETS = [
  ["agencyProduction", "agency"],
  ["agencyPreview", "agency"],
  ["agencyBranch", "agency"],
];
const SECOP_TARGETS = [
  ["secop", "secop"],
  ["secopValidation", "secop"],
];

function parseSemver(version) {
  if (typeof version !== "string") return null;
  const match = version.match(
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/,
  );
  if (!match) return null;
  const prerelease = match[4]?.split(".") ?? [];
  if (prerelease.some((part) => /^0\d+$/.test(part))) return null;
  return {
    major: BigInt(match[1]),
    minor: BigInt(match[2]),
    patch: BigInt(match[3]),
    prerelease,
  };
}

function compareIdentifier(left, right) {
  const leftNumeric = /^\d+$/.test(left);
  const rightNumeric = /^\d+$/.test(right);
  if (leftNumeric && rightNumeric) {
    const a = BigInt(left);
    const b = BigInt(right);
    return a < b ? -1 : a > b ? 1 : 0;
  }
  if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareSemver(left, right) {
  for (const field of ["major", "minor", "patch"]) {
    if (left[field] !== right[field])
      return left[field] < right[field] ? -1 : 1;
  }
  if (left.prerelease.length === 0 || right.prerelease.length === 0) {
    if (left.prerelease.length === right.prerelease.length) return 0;
    return left.prerelease.length === 0 ? 1 : -1;
  }
  const length = Math.min(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const comparison = compareIdentifier(
      left.prerelease[index],
      right.prerelease[index],
    );
    if (comparison !== 0) return comparison;
  }
  return left.prerelease.length < right.prerelease.length
    ? -1
    : left.prerelease.length > right.prerelease.length
      ? 1
      : 0;
}

function queryResults(result) {
  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.results)) return result.results;
  throw new Error("D1 query did not return a results array");
}

async function all(database, sql, ...values) {
  return queryResults(
    await database
      .prepare(sql)
      .bind(...values)
      .all(),
  );
}

async function run(database, sql, ...values) {
  const result = await database
    .prepare(sql)
    .bind(...values)
    .run();
  const changes = Number(result?.meta?.changes);
  if (!Number.isFinite(changes))
    throw new Error("D1 mutation did not report changes");
  return changes;
}

async function runBatch(database, statements) {
  if (statements.length === 0) return 0;
  if (typeof database.batch !== "function") {
    let total = 0;
    for (const statement of statements)
      total += await run(database, statement.sql, ...statement.values);
    return total;
  }
  const result = await database.batch(
    statements.map(({ sql, values }) => database.prepare(sql).bind(...values)),
  );
  return result.reduce((total, item) => {
    const changes = Number(item?.meta?.changes);
    if (!Number.isFinite(changes))
      throw new Error("D1 batch did not report changes");
    return total + changes;
  }, 0);
}

function cutoffOptions({ initial, now, field, timestamp }) {
  if (initial) return { sql: "", values: [] };
  const cutoff =
    timestamp === "iso" ? new Date(now - DAY_MS).toISOString() : now - DAY_MS;
  return { sql: ` AND ${field} < ?`, values: [cutoff] };
}

async function cleanActionRuns(database, options) {
  const cutoff = cutoffOptions({
    ...options,
    field: "updated_at",
    timestamp: "iso",
  });
  const sql = `DELETE FROM extension_action_runs WHERE rowid IN (
    SELECT rowid FROM extension_action_runs
    WHERE ${TERMINAL_RUNS}${cutoff.sql}
    ORDER BY updated_at, rowid LIMIT ?
  )`;
  let deleted = 0;
  for (let batch = 0; batch < options.maxBatches; batch += 1) {
    const changes = await run(
      database,
      sql,
      ...cutoff.values,
      options.batchSize,
    );
    deleted += changes;
    if (changes < options.batchSize) break;
  }
  const remaining = await database
    .prepare(
      `SELECT 1 AS found FROM extension_action_runs WHERE ${TERMINAL_RUNS}${cutoff.sql} LIMIT 1`,
    )
    .bind(...cutoff.values)
    .first();
  return { deleted, remaining: Boolean(remaining) };
}

async function cleanupPluginArtifacts(database, options) {
  const artifacts = await all(
    database,
    "SELECT tenant_id, id, version FROM plugin_store_artifacts ORDER BY tenant_id, id, version",
  );
  const installedRows = await all(
    database,
    "SELECT tenant_id, id, version FROM studio_extension_installations",
  );
  const groups = new Map();
  const groupKey = (tenantId, pluginId) => JSON.stringify([tenantId, pluginId]);
  for (const artifact of artifacts) {
    const key = groupKey(artifact.tenant_id, artifact.id);
    let group = groups.get(key);
    if (!group) {
      group = {
        tenantId: artifact.tenant_id,
        pluginId: artifact.id,
        versions: [],
        installed: new Set(),
      };
      groups.set(key, group);
    }
    group.versions.push(artifact.version);
  }
  for (const installation of installedRows) {
    groups
      .get(groupKey(installation.tenant_id, installation.id))
      ?.installed.add(installation.version);
  }
  const deleteCandidates = [];
  let invalidVersionGroups = 0;

  for (const group of groups.values()) {
    const versions = group.versions.map((version) => ({
      version,
      parsed: parseSemver(version),
    }));
    if (versions.some((item) => item.parsed === null)) {
      invalidVersionGroups += 1;
      continue;
    }

    let newest = versions[0];
    for (const candidate of versions.slice(1)) {
      if (compareSemver(candidate.parsed, newest.parsed) > 0)
        newest = candidate;
    }
    for (const candidate of versions) {
      if (
        compareSemver(candidate.parsed, newest.parsed) < 0 &&
        !group.installed.has(candidate.version)
      ) {
        deleteCandidates.push({
          tenantId: group.tenantId,
          pluginId: group.pluginId,
          version: candidate.version,
        });
      }
    }
  }

  let deleted = 0;
  let cursor = 0;
  for (
    let batch = 0;
    batch < options.maxBatches && cursor < deleteCandidates.length;
    batch += 1
  ) {
    const slice = deleteCandidates.slice(cursor, cursor + options.batchSize);
    cursor += slice.length;
    const statements = slice.map(({ tenantId, pluginId, version }) => ({
      sql: `DELETE FROM plugin_store_artifacts
        WHERE tenant_id=? AND id=? AND version=?
          AND NOT EXISTS (
            SELECT 1 FROM studio_extension_installations
            WHERE tenant_id=? AND id=? AND version=?
          )`,
      values: [tenantId, pluginId, version, tenantId, pluginId, version],
    }));
    deleted += await runBatch(database, statements);
  }

  const remaining = cursor < deleteCandidates.length;
  return { deleted, invalidVersionGroups, remaining };
}

async function cleanDossierRecords(database, options) {
  const cutoff = cutoffOptions({
    ...options,
    field: "updated_at",
    timestamp: "ms",
  });
  const sql = `DELETE FROM dossier_records WHERE rowid IN (
    SELECT rowid FROM dossier_records
    WHERE ${REPORT_CHUNK_KINDS}${cutoff.sql}
    ORDER BY updated_at, rowid LIMIT ?
  )`;
  let deleted = 0;
  for (let batch = 0; batch < options.maxBatches; batch += 1) {
    const changes = await run(
      database,
      sql,
      ...cutoff.values,
      options.batchSize,
    );
    deleted += changes;
    if (changes < options.batchSize) break;
  }
  const remaining = await database
    .prepare(
      `SELECT 1 AS found FROM dossier_records WHERE ${REPORT_CHUNK_KINDS}${cutoff.sql} LIMIT 1`,
    )
    .bind(...cutoff.values)
    .first();
  return { deleted, remaining: Boolean(remaining) };
}

function validateOptions(options) {
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const maxBatches = options.maxBatches ?? DEFAULT_MAX_BATCHES;
  if (
    !Number.isSafeInteger(batchSize) ||
    batchSize < 1 ||
    batchSize > DEFAULT_BATCH_SIZE
  ) {
    throw new TypeError(
      `batchSize must be an integer from 1 to ${DEFAULT_BATCH_SIZE}`,
    );
  }
  if (
    !Number.isSafeInteger(maxBatches) ||
    maxBatches < 1 ||
    maxBatches > 1000
  ) {
    throw new TypeError("maxBatches must be an integer from 1 to 1000");
  }
  const now = options.now ?? Date.now();
  if (
    typeof now !== "number" ||
    !Number.isFinite(now) ||
    !Number.isFinite(new Date(now).getTime())
  ) {
    throw new TypeError("now must be a valid epoch timestamp in milliseconds");
  }
  return { initial: options.initial === true, now, batchSize, maxBatches };
}

export async function runCleanup(env, options = {}) {
  const validated = validateOptions(options);
  const targets = {};
  for (const [binding, type] of [...AGENCY_TARGETS, ...SECOP_TARGETS]) {
    const database = env[binding];
    if (database == null) continue;
    if (typeof database.prepare !== "function") {
      throw new TypeError(`D1 binding ${binding} is not a database`);
    }
    if (type === "agency") {
      const extensionRuns = await cleanActionRuns(database, validated);
      const pluginArtifacts = await cleanupPluginArtifacts(database, validated);
      targets[binding] = { extensionRuns, pluginArtifacts };
    } else {
      targets[binding] = {
        dossierRecords: await cleanDossierRecords(database, validated),
      };
    }
  }
  return {
    mode: validated.initial ? "initial" : "daily",
    targets,
  };
}
