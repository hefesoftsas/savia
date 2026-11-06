import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

test("bootstrap command timing uses the configured Worker role and preserves failures", async () => {
  const directory = await mkdtemp(join(tmpdir(), "savia-runtime-ops-"));
  try {
    const normalizedInputs = {
      ...inputs,
      environment: "branch-timing-check",
      workers: [
        { name: "savia-auth-preview-timing-check", cloudId: "c".repeat(32) },
      ],
    };
    const operationDirectory = join(directory, "operations");
    const operations = createRuntimeOperations(normalizedInputs, {
      env: {
        CLOUDFLARE_ACCOUNT_ID: normalizedInputs.accountId,
        SAVIA_RUNTIME_OPERATION_DIRECTORY: operationDirectory,
      },
      client: {
        api: async () => ({
          id: "c".repeat(32),
          name: "savia-auth-preview-timing-check",
          deployed_on: null,
        }),
      },
      runWrangler: async () => ({ stdout: "PRIVATE_COMMAND_OUTPUT" }),
    });
    await operations.bootstrap();
    const file = (await readdir(operationDirectory)).find((name) =>
      name.startsWith("timings-"),
    );
    const content = await readFile(join(operationDirectory, file), "utf8");
    assert.match(content, /worker-deploy:auth/);
    assert.match(content, /"outcome":"success"/);
    assert.doesNotMatch(content, /PRIVATE_COMMAND_OUTPUT|args|env/);

    const failingDirectory = join(directory, "failure");
    const failing = createRuntimeOperations(normalizedInputs, {
      env: {
        CLOUDFLARE_ACCOUNT_ID: normalizedInputs.accountId,
        SAVIA_RUNTIME_OPERATION_DIRECTORY: failingDirectory,
      },
      client: {
        api: async () => ({
          id: "c".repeat(32),
          name: "savia-auth-preview-timing-check",
          deployed_on: null,
        }),
      },
      runWrangler: async () => {
        const error = new Error("PRIVATE_SENTINEL");
        error.stdout = "PRIVATE_SENTINEL";
        throw error;
      },
    });
    await assert.rejects(failing.bootstrap(), /Runtime helper failed/);
    const failureFile = (await readdir(failingDirectory)).find((name) =>
      name.startsWith("timings-"),
    );
    const failureContent = await readFile(
      join(failingDirectory, failureFile),
      "utf8",
    );
    assert.match(failureContent, /worker-deploy:auth/);
    assert.match(failureContent, /"outcome":"failure"/);
    assert.doesNotMatch(failureContent, /PRIVATE_SENTINEL/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
