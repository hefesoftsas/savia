import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";

import { assignWeightedShards } from "./admin-test-sequencer.mjs";

const adminRoot = resolve("/repo/apps/admin");
const spec = (path) => ({ moduleId: resolve(adminRoot, path) });
const pathOf = (item) => item.moduleId.slice(adminRoot.length + 1);
const shardPaths = (shards) => shards.map((shard) => shard.map(pathOf));

test("assigns the same weighted shards regardless of input order", () => {
  const files = [
    spec("src/b.test.ts"),
    spec("src/a.test.ts"),
    spec("src/c.test.ts"),
  ];
  const options = {
    shardCount: 2,
    weights: {
      "src/a.test.ts": 9000,
      "src/b.test.ts": 6000,
      "src/c.test.ts": 1000,
    },
    adminRoot,
  };

  const first = assignWeightedShards(files, options);
  const shuffled = assignWeightedShards([...files].reverse(), options);

  assert.deepEqual(shardPaths(first.shards), shardPaths(shuffled.shards));
  assert.deepEqual(shardPaths(first.shards), [
    ["src/a.test.ts"],
    ["src/b.test.ts", "src/c.test.ts"],
  ]);
});

test("breaks equal-weight ties by relative path and distributes to the lightest shard", () => {
  const files = [
    spec("src/c.test.ts"),
    spec("src/a.test.ts"),
    spec("src/b.test.ts"),
  ];
  const shards = assignWeightedShards(files, {
    shardCount: 2,
    weights: {},
    adminRoot,
  }).shards;

  assert.deepEqual(shardPaths(shards), [
    ["src/a.test.ts", "src/c.test.ts"],
    ["src/b.test.ts"],
  ]);
});

test("uses the default estimate for new files and ignores stale duration keys", () => {
  const files = [spec("src/new.test.ts")];
  const { shards, shardWeights } = assignWeightedShards(files, {
    shardCount: 2,
    weights: { "src/removed.test.ts": 999_999 },
    adminRoot,
  });

  assert.deepEqual(shardPaths(shards), [["src/new.test.ts"], []]);
  assert.deepEqual(shardWeights, [1000, 0]);
});

test("assigns each original specification exactly once without mutating the input", () => {
  const files = [
    spec("src/a.test.ts"),
    spec("src/b.test.ts"),
    spec("src/c.test.ts"),
  ];
  const original = [...files];
  const shards = assignWeightedShards(files, {
    shardCount: 3,
    weights: {},
    adminRoot,
  }).shards;

  assert.deepEqual(files, original);
  assert.deepEqual(shards.flat(), files);
  assert.equal(new Set(shards.flat()).size, files.length);
});

test("validates shard configuration and requires admin test paths", () => {
  assert.throws(
    () =>
      assignWeightedShards([spec("src/a.test.ts")], {
        shardCount: 0,
        adminRoot,
      }),
    /shardCount/,
  );
  assert.throws(
    () =>
      assignWeightedShards([spec("src/a.test.ts")], {
        shardCount: 2,
        shardIndex: 3,
        adminRoot,
      }),
    /shardIndex/,
  );
  assert.throws(
    () =>
      assignWeightedShards([{ moduleId: "/repo/apps/api/test.test.ts" }], {
        shardCount: 2,
        adminRoot,
      }),
    /outside apps\/admin/,
  );
  assert.throws(
    () =>
      assignWeightedShards([spec("src/a.test.ts"), spec("src/a.test.ts")], {
        shardCount: 2,
        adminRoot,
      }),
    /Duplicate apps\/admin test module/,
  );
});
