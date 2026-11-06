import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareRuntimeArtifact } from "./runtime-publisher.mjs";
import { warmupStandardRuntime } from "./runtime-warmup.mjs";
import {
  backupCapability,
  handleBackupControl,
} from "../../packages/backup-gate/control.mjs";
const accountId = "a".repeat(32);
test("new standard schema initialization requires create-only custody and empty storage before any write", async () => {
  const directory = await mkdtemp(join(tmpdir(), "savia-warmup-test-"));
  try {
    const source = join(directory, "source");
    await mkdir(source);
    await mkdir(join(source, "migrations"));
    await writeFile(join(source, "worker.mjs"), "export default {};");
    const names = [
      "savia-backup-coordinator-preview",
      "savia-preview",
      "savia-agencies-preview",
      "savia-auth-preview",
      "savia-mcp-preview",
      "savia-request-preview",
      "savia-connectors-preview",
      "savia-flows-preview",
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
              workers_dev:
                name === "savia-backup-coordinator-preview" ||
                /^savia-(auth|request|connectors)-preview$/.test(name),
              preview_urls: /^savia-(auth|request|connectors)-preview$/.test(
                name,
              ),
              ...(name === "savia-agencies-preview"
                ? { vars: { KEEP_API_CONTROL: "preserve" } }
                : name === "savia-flows-preview"
                  ? {
                      vars: {
                        KEEP_FLOWS_CONTROL: "preserve",
                        SAVIA_FLOWS_POLICY_GENERATION: "8",
                        SAVIA_FLOWS_EXECUTION_ENABLED: "true",
                      },
                      d1_databases: [{ binding: "DB", database_name: "flows" }],
                    }
                  : {}),
              queues: { consumers: [{ queue: "writer-events" }] },
              ...(name === "savia-agencies-preview"
                ? {
                    secrets: {
                      required: ["ASSISTANT_SETTINGS_ENCRYPTION_KEY"],
                    },
                  }
                : name === "savia-auth-preview"
                  ? { secrets: { required: ["BETTER_AUTH_SECRET"] } }
                  : name === "savia-request-preview"
                    ? { secrets: { required: ["ENCRYPTION_KEY"] } }
                    : name === "savia-connectors-preview"
                      ? {
                          secrets: {
                            required: ["EXTENSION_CONNECTIONS_ENCRYPTION_KEY"],
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
      missingSecretWorker = null;
    const requiredSecrets = {
      "savia-agencies-preview": "ASSISTANT_SETTINGS_ENCRYPTION_KEY",
      "savia-auth-preview": "BETTER_AUTH_SECRET",
      "savia-request-preview": "ENCRYPTION_KEY",
      "savia-connectors-preview": "EXTENSION_CONNECTIONS_ENCRYPTION_KEY",
    };
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
                  bindings:
                    path.split("/").at(-2) === missingSecretWorker
                      ? []
                      : [
                          {
                            type: "secret_text",
                            name: requiredSecrets[path.split("/").at(-2)],
                          },
                        ],
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
    assert.equal(deployed.length, 6);
    const configs = await Promise.all(
      deployed.map((row) => readFile(row[1][2], "utf8").then(JSON.parse)),
    );
    const byName = new Map(configs.map((config) => [config.name, config]));
    for (const name of [
      "savia-auth-preview",
      "savia-request-preview",
      "savia-connectors-preview",
    ]) {
      const config = byName.get(name);
      assert.equal(config.vars.SAVIA_RUNTIME_WARMUP, "true");
      assert.equal(config.vars.SAVIA_MAINTENANCE, "true");
      assert.equal(config.workers_dev, false);
      assert.equal(config.preview_urls, false);
      assert.deepEqual(config.routes, []);
      assert.deepEqual(config.triggers.crons, []);
      assert.deepEqual(config.queues.consumers, []);
    }
    assert.equal(
      byName.get("savia-backup-coordinator-preview").workers_dev,
      true,
    );
    assert.equal(byName.has("savia-preview"), false);
    assert.equal(byName.has("savia-mcp-preview"), false);
    assert.equal(byName.has("savia-hook-executor-preview"), false);
    assert.equal(
      byName.get("savia-agencies-preview").vars.KEEP_API_CONTROL,
      "preserve",
    );
    assert.equal(
      byName.get("savia-flows-preview").vars.KEEP_FLOWS_CONTROL,
      "preserve",
    );
    assert.equal(
      byName.get("savia-flows-preview").vars.SAVIA_FLOWS_POLICY_GENERATION,
      "7",
    );
    assert.equal(
      byName.get("savia-flows-preview").vars.SAVIA_FLOWS_EXECUTION_ENABLED,
      "false",
    );
    assert.deepEqual(byName.get("savia-flows-preview").queues.consumers, []);
    const freshSecretUploads = calls
      .filter((row) => row[0] === "wrangler" && row[1][0] === "secret")
      .map((row) => row[1][3]);
    for (const name of [
      "savia-auth-preview",
      "savia-request-preview",
      "savia-connectors-preview",
    ])
      assert.ok(
        freshSecretUploads.some((path) => path.endsWith(`${name}.json`)),
      );
    calls.length = 0;
    existing = true;
    missingSecretWorker = "savia-request-preview";
    await assert.rejects(
      warmupStandardRuntime(inputs, { ...deps, fresh: false }),
      /secret custody is incomplete/,
    );
    assert.equal(calls.length, 0);
    missingSecretWorker = null;
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
    const retainedDeployments = calls.filter((row) => row[1][0] === "deploy");
    assert.equal(retainedDeployments.length, 6);
    const retainedConfigs = await Promise.all(
      retainedDeployments.map((row) =>
        readFile(row[1][2], "utf8").then(JSON.parse),
      ),
    );
    for (const name of [
      "savia-auth-preview",
      "savia-request-preview",
      "savia-connectors-preview",
    ]) {
      const config = retainedConfigs.find((item) => item.name === name);
      assert.equal(config.workers_dev, false);
      assert.equal(config.preview_urls, false);
      assert.deepEqual(config.routes, []);
      assert.deepEqual(config.triggers.crons, []);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("retained production warmup makes real backup-gate writer verification pass before any schema migration", async () => {
  const directory = await mkdtemp(
    join(tmpdir(), "savia-production-gate-warmup-"),
  );
  try {
    const source = join(directory, "source");
    await mkdir(source);
    await mkdir(join(source, "migrations"));
    await writeFile(join(source, "worker.mjs"), "export default {};");
    const names = [
      "savia",
      "savia-agencies",
      "savia-auth",
      "savia-mcp",
      "savia-request",
      "savia-connectors",
      "savia-hook-executor",
      "savia-backup-coordinator",
    ];
    const peerBindings = [
      {
        name: "BACKUP_GATE",
        class_name: "BackupCoordinator",
        script_name: "savia-backup-coordinator",
      },
    ];
    const requiredSecrets = {
      "savia-agencies": ["SAVIA_BACKUP_CONTROL_SECRET"],
      "savia-auth": ["BETTER_AUTH_SECRET"],
      "savia-request": ["ENCRYPTION_KEY"],
      "savia-connectors": ["EXTENSION_CONNECTIONS_ENCRYPTION_KEY"],
    };
    const artifact = await prepareRuntimeArtifact({
      environment: "production",
      release: {
        directory: source,
        configs: Object.fromEntries(
          names.map((name) => [
            `${name}.json`,
            {
              name,
              main: "worker.mjs",
              workers_dev:
                name === "savia-backup-coordinator" ||
                /^savia-(auth|request|connectors)$/.test(name),
              preview_urls: /^savia-(auth|request|connectors)$/.test(name),
              vars: {
                SAVIA_BACKUP_GATE_REQUIRED: "true",
                ...(name === "savia-agencies"
                  ? { SAVIA_FLOWS_EXECUTION_ENABLED: "false" }
                  : {}),
              },
              ...(name === "savia-auth" ||
              name === "savia-request" ||
              name === "savia-connectors" ||
              name === "savia-agencies"
                ? { durable_objects: { bindings: peerBindings } }
                : {}),
              ...(requiredSecrets[name]
                ? { secrets: { required: requiredSecrets[name] } }
                : {}),
              routes: [{ pattern: "savia.hefesoft.com/*" }],
              triggers: { crons: ["* * * * *"] },
              queues: { consumers: [{ queue: "writer-events" }] },
            },
          ]),
        ),
      },
      destination: join(directory, "artifact"),
    });
    const inputs = {
      ...artifact,
      accountId,
      environment: "production",
      workers: names.map((name) => ({ name, cloudId: "b".repeat(32) })),
    };
    const env = {
      CLOUDFLARE_ACCOUNT_ID: accountId,
      SAVIA_DEPLOY_ENVIRONMENT: "production",
      SAVIA_BACKUP_CONTROL_SECRET: "s".repeat(64),
      BETTER_AUTH_SECRET: "a".repeat(64),
      SAVIA_MCP_SHARED_SECRET: "m".repeat(64),
      SAVIA_REQUEST_ENCRYPTION_KEY: "r".repeat(64),
      EXTENSION_CONNECTIONS_ENCRYPTION_KEY: "e".repeat(64),
      ASSISTANT_SETTINGS_ENCRYPTION_KEY: "c".repeat(64),
      STUDIO_INTEGRATION_KEY: "t".repeat(64),
      NANGO_API_KEY: "n".repeat(32),
    };
    const gateNamespace = {
      idFromName: () => ({ toString: () => "production-backup-v1" }),
      get: () => ({
        fetch: async (request) => {
          assert.equal(new URL(request.url).pathname, "/acquire");
          return Response.json({
            owner: "release-backup",
            expiresAt: Date.now() + 120_000,
            active: 0,
            drained: true,
          });
        },
      }),
    };
    const activeConfigs = new Map();
    let coordinatorCalls = 0,
      migrations = 0;
    const peer = (workerName) => ({
      fetch: async (request) => {
        const config = activeConfigs.get(workerName);
        if (!config)
          return new Response("Environment unavailable", { status: 503 });
        const binding = config.durable_objects?.bindings?.find(
          (item) =>
            item.name === "BACKUP_GATE" &&
            item.class_name === "BackupCoordinator" &&
            item.script_name === "savia-backup-coordinator",
        );
        const response = backupCapability(
          request,
          binding
            ? {
                SAVIA_BACKUP_GATE_REQUIRED:
                  config.vars.SAVIA_BACKUP_GATE_REQUIRED,
                BACKUP_GATE: gateNamespace,
              }
            : {
                SAVIA_BACKUP_GATE_REQUIRED:
                  config.vars.SAVIA_BACKUP_GATE_REQUIRED,
              },
        );
        return response ?? new Response("Not found", { status: 404 });
      },
    });
    const manifest = JSON.parse(
      await readFile(
        join(artifact.artifactDirectory, "release-manifest.json"),
        "utf8",
      ),
    );
    const apiConfig = manifest.configs.find((file) =>
      file.includes("savia-agencies"),
    );
    const apiSourceConfig = JSON.parse(
      await readFile(join(artifact.artifactDirectory, apiConfig), "utf8"),
    );
    const backupRequest = () =>
      new Request(
        "https://coordinator.workers.dev/api/_internal/backup-gate/acquire",
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${env.SAVIA_BACKUP_CONTROL_SECRET}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ owner: "release-backup", ttlMs: 120_000 }),
        },
      );
    const acquire = () =>
      handleBackupControl(backupRequest(), {
        SAVIA_BACKUP_CONTROL_SECRET: env.SAVIA_BACKUP_CONTROL_SECRET,
        SAVIA_BACKUP_GATE_REQUIRED:
          apiSourceConfig.vars.SAVIA_BACKUP_GATE_REQUIRED,
        SAVIA_FLOWS_EXECUTION_ENABLED: "false",
        BACKUP_GATE: {
          ...gateNamespace,
          get: (...args) => {
            coordinatorCalls += 1;
            return gateNamespace.get(...args);
          },
        },
        AUTH: peer("savia-auth"),
        SAVIA_REQUEST: peer("savia-request"),
        CONNECTOR_GATEWAY: peer("savia-connectors"),
      });

    assert.equal((await acquire()).status, 503);
    assert.equal(coordinatorCalls, 0);

    await warmupStandardRuntime(inputs, {
      client: {
        api: async (path) => {
          const workerName = path.split("/").at(-2);
          return {
            bindings: (requiredSecrets[workerName] ?? []).map((name) => ({
              type: "secret_text",
              name,
            })),
          };
        },
      },
      env,
      root: directory,
      directory: join(directory, "warmup"),
      fresh: false,
      run: async () => {
        migrations += 1;
      },
      runWrangler: async (args) => {
        if (args[0] !== "deploy") return;
        const config = JSON.parse(await readFile(args[2], "utf8"));
        activeConfigs.set(config.name, config);
      },
    });

    assert.equal(migrations, 0);
    assert.equal((await acquire()).status, 200);
    assert.equal(coordinatorCalls, 1);
    assert.deepEqual([...activeConfigs.keys()].sort(), [
      "savia-agencies",
      "savia-auth",
      "savia-backup-coordinator",
      "savia-connectors",
      "savia-request",
    ]);
    for (const name of ["savia-auth", "savia-request", "savia-connectors"]) {
      const config = activeConfigs.get(name);
      assert.equal(config.workers_dev, false);
      assert.equal(config.preview_urls, false);
      assert.deepEqual(config.routes, []);
      assert.deepEqual(config.triggers.crons, []);
      assert.deepEqual(config.queues.consumers, []);
    }
    assert.equal(activeConfigs.has("savia"), false);
    assert.equal(activeConfigs.has("savia-mcp"), false);
    assert.equal(activeConfigs.has("savia-hook-executor"), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
