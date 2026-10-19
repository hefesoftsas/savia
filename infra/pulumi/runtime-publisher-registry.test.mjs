import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareRuntimeArtifact } from "./runtime-publisher.mjs";
import { publishRegistryRuntime } from "./runtime-publisher-registry.mjs";

test("registry publication validates its exact shared target and keeps credentials on stdin", async () => {
  const root = await mkdtemp(join(tmpdir(), "savia-registry-release-"));
  try {
    const source = join(root, "source");
    await mkdir(source);
    await writeFile(join(source, "worker.mjs"), "export default {};");
    const artifact = await prepareRuntimeArtifact({
      environment: "shared",
      release: {
        directory: source,
        configs: {
          "wrangler.json": {
            name: "savia-plugin-registry",
            main: "worker.mjs",
            r2_buckets: [
              { binding: "BUCKET", bucket_name: "savia-plugin-registry" },
            ],
          },
        },
      },
      destination: join(root, "artifact"),
    });
    const inputs = {
      ...artifact,
      accountId: "a".repeat(32),
      workers: [{ name: "savia-plugin-registry", cloudId: "b".repeat(32) }],
    };
    const calls = [];
    const env = {
      CLOUDFLARE_ACCOUNT_ID: inputs.accountId,
      REGISTRY_CREDENTIALS: '[{"hash":"SYNTHETIC_CREDENTIAL_CANARY"}]',
    };
    await publishRegistryRuntime(inputs, {
      env,
      runWrangler: async (args, options) =>
        calls.push({ args, input: options.input }),
    });
    assert.deepEqual(
      calls.map((row) => row.args[0]),
      ["secret", "deploy", "deployments"],
    );
    assert.equal(calls[0].input.includes("SYNTHETIC_CREDENTIAL_CANARY"), true);
    assert.equal(
      JSON.stringify(calls.map((row) => row.args)).includes(
        "SYNTHETIC_CREDENTIAL_CANARY",
      ),
      false,
    );
    calls.length = 0;
    await assert.rejects(
      publishRegistryRuntime(
        { ...inputs, environment: "preview" },
        { env, runWrangler: async () => calls.push("mutation") },
      ),
      /shared|registry/,
    );
    assert.deepEqual(calls, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
