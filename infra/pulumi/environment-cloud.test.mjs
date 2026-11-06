import test from "node:test";
import assert from "node:assert/strict";
import { listEnvironmentCloudResources } from "./environment-cloud.mjs";
test("inventory emits identities and dependency names without cloud binding values", async () => {
  const accountId = "a".repeat(32),
    name = "savia-preview",
    cloudId = "b".repeat(32);
  const rows = await listEnvironmentCloudResources({
    accountId,
    env: {},
    buckets: async () => [{ name: "savia-documents-preview" }],
    makeClient: () => ({
      list: async (path) =>
        path === "/workers/workers" ? [{ id: cloudId, name }] : [],
      api: async () => ({
        bindings: [
          { type: "secret_text", name: "PRIVATE", text: "SECRET_CANARY" },
          { type: "service", name: "SERVICE", service: "savia-auth-preview" },
        ],
      }),
      readSnapshot: async () => ({
        workerVersions: [{ name, cloudId, versionId: "v1" }],
        namespaceIds: [],
        attachments: [],
        secretWorkerNames: [name],
      }),
      readRoutes: async () => [],
    }),
  });
  const worker = rows.find((row) => row.kind === "worker");
  assert.equal(worker.hasOpaqueSecrets, true);
  assert.deepEqual(worker.dependencies, ["savia-auth-preview"]);
  assert.equal(JSON.stringify(rows).includes("SECRET_CANARY"), false);
  assert.equal(rows.filter((row) => row.kind === "r2").length, 1);
});

test("Preview inventory takes dependencies from serving versions without settings requests", async () => {
  const accountId = "a".repeat(32),
    name = "savia-auth-preview",
    cloudId = "b".repeat(32);
  let snapshotOptions, clientOptions;
  const rows = await listEnvironmentCloudResources({
    accountId,
    env: { SAVIA_DEPLOY_ENVIRONMENT: "preview" },
    buckets: async () => [],
    makeClient: (_inputs, options) => {
      clientOptions = options;
      return {
        list: async (path) =>
          path === "/workers/workers" ? [{ id: cloudId, name }] : [],
        api: async (path) => {
          assert.notEqual(path, `/workers/scripts/${name}/settings`);
          assert.fail(`Unexpected API request ${path}`);
        },
        readSnapshot: async (options) => {
          snapshotOptions = options;
          return {
            workerVersions: [{ name, cloudId, versionId: "v-serving" }],
            workerDependencies: [
              { name, dependencies: ["savia-request-preview"] },
            ],
            namespaceIds: [],
            attachments: [],
            secretWorkerNames: [name],
          };
        },
        readRoutes: async () => [],
      };
    },
  });
  const worker = rows.find((row) => row.kind === "worker");
  assert.deepEqual(snapshotOptions, {
    allowUndeployed: true,
    includeDependencies: true,
  });
  assert.equal(clientOptions.readConcurrency, 4);
  assert.deepEqual(worker.dependencies, ["savia-request-preview"]);
  assert.equal(worker.hasOpaqueSecrets, true);
  assert.equal(JSON.stringify(rows).includes("SECRET_CANARY"), false);
});

test("non-Preview inventory remains serial and reads existing settings dependencies", async () => {
  const accountId = "a".repeat(32),
    name = "savia-auth-production",
    cloudId = "c".repeat(32);
  let snapshotOptions,
    clientOptions,
    settingsCalls = 0;
  const rows = await listEnvironmentCloudResources({
    accountId,
    env: { SAVIA_DEPLOY_ENVIRONMENT: "production" },
    buckets: async () => [],
    makeClient: (_inputs, options) => {
      clientOptions = options;
      return {
        list: async (path) =>
          path === "/workers/workers" ? [{ id: cloudId, name }] : [],
        api: async (path) => {
          assert.equal(path, `/workers/scripts/${name}/settings`);
          settingsCalls++;
          return {
            bindings: [
              { type: "service", service: "savia-request-production" },
            ],
          };
        },
        readSnapshot: async (options) => {
          snapshotOptions = options;
          return {
            workerVersions: [{ name, cloudId, versionId: "v-serving" }],
            namespaceIds: [],
            attachments: [],
            secretWorkerNames: [],
          };
        },
        readRoutes: async () => [],
      };
    },
  });
  const worker = rows.find((row) => row.kind === "worker");
  assert.deepEqual(snapshotOptions, { allowUndeployed: true });
  assert.equal(clientOptions.readConcurrency, 1);
  assert.equal(settingsCalls, 1);
  assert.deepEqual(worker.dependencies, ["savia-request-production"]);
});
