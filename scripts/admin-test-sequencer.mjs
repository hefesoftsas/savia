import { readFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { BaseSequencer } from "vitest/node";

const ADMIN_ROOT = fileURLToPath(new URL("../apps/admin/", import.meta.url));
const DEFAULT_DURATION_MS = 1000;
const durationsPath = new URL("./admin-test-durations.json", import.meta.url);
const durations = JSON.parse(readFileSync(durationsPath, "utf8"));

function relativeAdminTestPath(moduleId, adminRoot) {
  const absolutePath = isAbsolute(moduleId)
    ? resolve(moduleId)
    : resolve(adminRoot, moduleId);
  const path = relative(adminRoot, absolutePath).split("\\").join("/");
  if (!path || path === ".." || path.startsWith("../") || isAbsolute(path)) {
    throw new Error(`Test module is outside apps/admin: ${moduleId}`);
  }
  return path;
}

/**
 * Assign every input test specification to one deterministic, weighted shard.
 * Weights are advisory: tests without an entry keep the default estimate.
 */
export function assignWeightedShards(
  specifications,
  { shardIndex = 1, shardCount, weights = {}, adminRoot = ADMIN_ROOT },
) {
  if (!Number.isInteger(shardCount) || shardCount < 1) {
    throw new RangeError("shardCount must be a positive integer");
  }
  if (
    !Number.isInteger(shardIndex) ||
    shardIndex < 1 ||
    shardIndex > shardCount
  ) {
    throw new RangeError("shardIndex must be between 1 and shardCount");
  }

  const paths = new Map();
  for (const specification of specifications) {
    const path = relativeAdminTestPath(specification.moduleId, adminRoot);
    if (paths.has(path)) {
      throw new Error(`Duplicate apps/admin test module: ${path}`);
    }
    const weight = weights[path] ?? DEFAULT_DURATION_MS;
    if (!Number.isFinite(weight) || weight <= 0) {
      throw new RangeError(`Invalid duration estimate for ${path}`);
    }
    paths.set(path, { specification, weight });
  }

  const shards = Array.from({ length: shardCount }, () => []);
  const shardWeights = Array.from({ length: shardCount }, () => 0);
  const ordered = [...paths.entries()].sort(
    ([pathA, entryA], [pathB, entryB]) =>
      entryB.weight - entryA.weight ||
      (pathA < pathB ? -1 : pathA > pathB ? 1 : 0),
  );

  for (const [path, { specification, weight }] of ordered) {
    let targetIndex = 0;
    for (let index = 1; index < shardCount; index++) {
      if (shardWeights[index] < shardWeights[targetIndex]) {
        targetIndex = index;
      }
    }
    shards[targetIndex].push(specification);
    shardWeights[targetIndex] += weight;
  }

  return { shards, shardWeights };
}

export default class AdminTestSequencer extends BaseSequencer {
  async shard(specifications) {
    const { index, count } = this.ctx.config.shard;
    const { shards } = assignWeightedShards(specifications, {
      shardIndex: index,
      shardCount: count,
      weights: durations,
    });
    return shards[index - 1];
  }
}
