import test from "node:test";
import assert from "node:assert/strict";
import { createRuntimeOperations } from "./runtime-operations.mjs";
const inputs = {
  accountId: "a".repeat(32),
  environment: "preview",
  workers: [{ name: "savia-preview", cloudId: "b".repeat(32) }],
  mode: "adopt",
};
test("default runtime adoption reads cloud metadata without opening an artifact or spawning commands", async () => {
  let reads = 0;
  const operations = createRuntimeOperations(
    { ...inputs, artifactDirectory: "/missing-old-release" },
    {
      env: {},
      client: {
        readSnapshot: async () => {
          reads++;
          return { workerVersions: [] };
        },
      },
      run: async () => assert.fail("spawned command"),
    },
  );
  await operations.readSnapshot();
  assert.equal(reads, 1);
});
test("recovery restores every recorded Worker and propagates a failed restore", async () => {
  const calls = [];
  const operations = createRuntimeOperations(
    {
      ...inputs,
      workers: [
        ...inputs.workers,
        { name: "savia-auth-preview", cloudId: "c".repeat(32) },
      ],
    },
    {
      env: {},
      client: { api: async (path, options) => calls.push({ path, options }) },
    },
  );
  await operations.recover({
    workerVersions: [
      { name: "savia-preview", versionId: "v1" },
      { name: "savia-auth-preview", versionId: "v2" },
    ],
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].options.body.versions[0].version_id, "v2");
  const broken = createRuntimeOperations(inputs, {
    env: {},
    client: {
      api: async () => {
        throw new Error("restore failed");
      },
    },
  });
  await assert.rejects(
    broken.recover({
      workerVersions: [{ name: "savia-preview", versionId: "v1" }],
    }),
    /restore failed/,
  );
});
test("production publication cannot bypass the existing operations gate", async () => {
  const operations = createRuntimeOperations(
    { ...inputs, environment: "production" },
    { env: {}, client: {} },
  );
  await assert.rejects(operations.verifyArtifact(), /production.*disabled/i);
});
