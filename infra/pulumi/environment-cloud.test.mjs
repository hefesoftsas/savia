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
