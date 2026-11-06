import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootstrapRuntimeWorkers } from "./runtime-bootstrap.mjs";

test("cold bootstrap publishes private unavailable placeholders only for new identities", async () => {
  const directory = await mkdtemp(join(tmpdir(), "savia-bootstrap-test-"));
  try {
    const workers = [
      { name: "savia-preview", cloudId: "b".repeat(32) },
      { name: "savia-auth-preview", cloudId: "c".repeat(32) },
    ];
    const calls = [];
    const client = {
      api: async (path) => {
        if (path.includes(workers[0].cloudId))
          return { ...workers[0], id: workers[0].cloudId, deployed_on: null };
        if (path.includes(workers[1].cloudId))
          return {
            ...workers[1],
            id: workers[1].cloudId,
            deployed_on: "2026-10-19T12:00:00Z",
          };
        return { bindings: [] };
      },
    };
    const result = await bootstrapRuntimeWorkers(
      { workers },
      { client, directory, runWrangler: async (args) => calls.push(args) },
    );
    assert.deepEqual(result.createdWorkers, ["savia-preview"]);
    assert.equal(calls.length, 1);
    const config = JSON.parse(await readFile(calls[0][2], "utf8"));
    assert.equal(config.workers_dev, false);
    assert.equal(config.preview_urls, false);
    assert.equal(config.vars.SAVIA_RUNTIME_BOOTSTRAP, "true");
    assert.doesNotMatch(
      await readFile(join(directory, "bootstrap.mjs"), "utf8"),
      /migrations|storage|namespace/,
    );
    const retryDirectory = join(directory, "retry");
    await mkdir(retryDirectory);
    client.api = async (path) => {
      const worker = workers.find((row) => path.includes(row.cloudId));
      if (worker)
        return {
          ...worker,
          id: worker.cloudId,
          deployed_on: "2026-10-19T12:00:00Z",
        };
      return {
        bindings: path.includes(workers[0].name)
          ? [
              {
                type: "plain_text",
                name: "SAVIA_RUNTIME_BOOTSTRAP",
                text: "true",
              },
            ]
          : [],
      };
    };
    const retried = await bootstrapRuntimeWorkers(
      { workers },
      {
        client,
        directory: retryDirectory,
        runWrangler: async (args) => calls.push(args),
      },
    );
    assert.deepEqual(retried.createdWorkers, [workers[0].name]);
    assert.equal(calls.length, 1);
    assert.equal(
      JSON.parse(
        await readFile(
          join(retryDirectory, `${workers[0].name}.bootstrap.json`),
          "utf8",
        ),
      ).name,
      workers[0].name,
    );
    client.api = async () => ({
      name: "other",
      id: workers[0].cloudId,
      deployed_on: null,
    });
    await assert.rejects(
      bootstrapRuntimeWorkers(
        { workers },
        { client, directory, runWrangler: async () => calls.push("mutation") },
      ),
      /identity/,
    );
    assert.equal(calls.length, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
