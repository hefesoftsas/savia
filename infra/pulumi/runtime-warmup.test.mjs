import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareRuntimeArtifact } from "./runtime-publisher.mjs";
import { warmupStandardRuntime } from "./runtime-warmup.mjs";
const accountId = "a".repeat(32);
test("new standard schema initialization requires create-only custody and empty storage before any write", async () => {
  const directory = await mkdtemp(join(tmpdir(), "savia-warmup-test-"));
  try {
    const source = join(directory, "source");
    await mkdir(source);
    await mkdir(join(source, "migrations"));
    await writeFile(join(source, "worker.mjs"), "export default {};");
    const names = [
      "savia-preview",
      "savia-agencies-preview",
      "savia-auth-preview",
      "savia-mcp-preview",
      "savia-request-preview",
      "savia-connectors-preview",
      "savia-hook-executor-preview",
    ];
    const artifact = await prepareRuntimeArtifact({
      environment: "preview",
      release: {
        directory: source,
        configs: Object.fromEntries(
          names.map((name) => [
            `${name}.json`,
            {
              name,
              main: "worker.mjs",
              ...(name === "savia-agencies-preview"
                ? {
                    secrets: {
                      required: ["ASSISTANT_SETTINGS_ENCRYPTION_KEY"],
                    },
                  }
                : {}),
              routes: [
                { pattern: "savia-preview.hefesoft.com", custom_domain: true },
              ],
              triggers: { crons: ["0 * * * *"] },
            },
          ]),
        ),
      },
      destination: join(directory, "artifact"),
    });
    const resources = [
      {
        kind: "d1",
        name: "savia-domain-preview",
        cloudId: "11111111-1111-4111-8111-111111111111",
      },
      {
        kind: "r2",
        name: "savia-documents-preview",
        cloudId: "savia-documents-preview",
      },
    ];
    const inputs = {
      ...artifact,
      accountId,
      workers: names.map((name) => ({ name, cloudId: "b".repeat(32) })),
      adoptionManifest: { resources },
    };
    const calls = [],
      env = {
        CLOUDFLARE_ACCOUNT_ID: accountId,
        SAVIA_DEPLOY_ENVIRONMENT: "preview",
        SAVIA_DOMAIN_D1_ID: resources[0].cloudId,
      };
    for (const key of [
      "BETTER_AUTH_SECRET",
      "SAVIA_MCP_SHARED_SECRET",
      "SAVIA_REQUEST_ENCRYPTION_KEY",
      "EXTENSION_CONNECTIONS_ENCRYPTION_KEY",
      "ASSISTANT_SETTINGS_ENCRYPTION_KEY",
      "STUDIO_INTEGRATION_KEY",
      "NANGO_API_KEY",
    ])
      env[key] = "CANARY_SECRET";
    let existing = false,
      hasOpaque = true;
    const deps = {
      env,
      root: directory,
      directory: join(directory, "warmup"),
      fresh: true,
      createdWorkers: names,
      client: {
        readSnapshot: async () => ({ namespaceIds: [], attachments: [] }),
        inspectReferences: async () => [],
        api: async (path) =>
          path.includes("/query")
            ? [
                {
                  success: true,
                  results: existing ? [{ name: "business" }] : [],
                },
              ]
            : path.endsWith("/settings")
              ? {
                  bindings: hasOpaque
                    ? [
                        {
                          type: "secret_text",
                          name: "ASSISTANT_SETTINGS_ENCRYPTION_KEY",
                        },
                      ]
                    : [],
                }
              : [],
      },
      run: async (...args) => calls.push(args),
      runWrangler: async (args, options) =>
        calls.push(["wrangler", args, options]),
    };
    await assert.rejects(warmupStandardRuntime(inputs, deps), /create-only/);
    assert.equal(calls.length, 0);
    inputs.bootstrapProof = {
      version: 1,
      accountId,
      environment: "preview",
      resources,
      planDigest: "d".repeat(64),
    };
    existing = true;
    await assert.rejects(
      warmupStandardRuntime(inputs, deps),
      /existing D1 schema/,
    );
    assert.equal(calls.length, 0);
    existing = false;
    await warmupStandardRuntime(inputs, deps);
    assert.equal(calls[0][0], "node");
    assert.equal(
      JSON.stringify(calls.map((row) => row.slice(0, 2))).includes(
        "CANARY_SECRET",
      ),
      false,
    );
    const deployed = calls.filter((row) => row[1][0] === "deploy");
    assert.equal(deployed.length, 1);
    const config = JSON.parse(await readFile(deployed[0][1][2], "utf8"));
    assert.equal(config.vars.SAVIA_RUNTIME_WARMUP, "true");
    assert.equal(config.vars.SAVIA_MAINTENANCE, "true");
    assert.deepEqual(config.routes, []);
    assert.deepEqual(config.triggers.crons, []);
    calls.length = 0;
    existing = true;
    hasOpaque = false;
    await assert.rejects(
      warmupStandardRuntime(inputs, { ...deps, fresh: false }),
      /secret custody is incomplete/,
    );
    assert.equal(calls.length, 0);
    hasOpaque = true;
    await warmupStandardRuntime(inputs, { ...deps, fresh: false });
    assert.equal(
      calls.some((row) => row[1][0] === "secret"),
      false,
      "retained opaque keys must never be overwritten before recovery backup",
    );
    assert.equal(
      calls.some(([binary]) => binary === "node"),
      false,
      "retained schema must not migrate before backup",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
