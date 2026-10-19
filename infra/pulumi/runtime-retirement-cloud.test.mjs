import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { retireCloudRuntime } from "./runtime-retirement-cloud.mjs";

test("cloud retirement keeps opaque keys without reading artifacts or serializing their values", async () => {
  const directory = await mkdtemp(join(tmpdir(), "savia-retire-test-"));
  try {
    const worker = { name: "savia-request-preview", cloudId: "b".repeat(32) };
    const inputs = {
      accountId: "a".repeat(32),
      environment: "preview",
      workers: [worker],
    };
    const calls = [];
    const client = {
      readSnapshot: async () => ({
        workerVersions: [{ ...worker, versionId: "v1" }],
        namespaceIds: [],
        attachments: [],
        secretWorkerNames: [worker.name],
      }),
      api: async (path, options) => {
        calls.push({ path, method: options?.method ?? "GET" });
        return path.endsWith("/settings")
          ? {
              bindings: [
                {
                  name: "ENCRYPTION_KEY",
                  type: "secret_text",
                  text: "SECRET_CANARY",
                },
              ],
            }
          : { default_environment: { script: { migration_tag: null } } };
      },
      inspectReferences: async () => [],
    };
    const runWrangler = async (args) => {
      assert.equal(args[0], "deploy");
      const raw = await readFile(args[2], "utf8");
      assert.equal(raw.includes("SECRET_CANARY"), false);
      assert.equal(JSON.parse(raw).name, worker.name);
    };
    const result = await retireCloudRuntime(
      inputs,
      { namespaceIds: [] },
      {},
      { client, directory, runWrangler, sleep: async () => {} },
    );
    assert.deepEqual(result.retainedWorkers, [worker.name]);
    assert.deepEqual(result.deletedWorkers, []);
    calls.length = 0;
    client.inspectReferences = async () => [
      { caller: "other-product", target: worker.name },
    ];
    await assert.rejects(
      retireCloudRuntime(
        inputs,
        { namespaceIds: [] },
        {},
        { client, directory, runWrangler, sleep: async () => {} },
      ),
      /outside/,
    );
    assert.equal(
      calls.some((row) => row.method !== "GET"),
      false,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
