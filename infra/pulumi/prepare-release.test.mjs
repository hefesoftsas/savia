import test from "node:test";
import assert from "node:assert/strict";
import { prepareEnvironmentRelease } from "./prepare-release.mjs";
import { resolveInfraNames } from "./naming.mjs";
test("standard preparation derives actual binding IDs, freezes the exact source and builds before publication", async () => {
  const accountId = "a".repeat(32),
    names = resolveInfraNames({
      environment: "preview",
      documentsBucket: "savia-documents-preview",
      publicOrigin: "https://savia-preview.hefesoft.com",
    }),
    events = [];
  const outputs = {
    cloudflareAccountId: accountId,
    authD1Id: "auth-id",
    domainD1Id: "domain-id",
    documentsBucketName: names.bucket,
    resolvedEnvironment: "preview",
    resolvedPublicOrigin: names.publicOrigin,
    workerNames: names.workers,
    databaseNames: names.databases,
    deletionProtected: false,
    flowsEnabled: false,
    flowsResources: null,
    flowsExecutionEnabled: false,
    plannedFlowsResourceNames: names.flows,
    tenantSubdomains: [],
    vectorizeIndex: names.vectorizeIndex,
  };
  const result = await prepareEnvironmentRelease(
    { environment: "preview", destination: "/tmp/not-created-release" },
    {
      env: { CLOUDFLARE_ACCOUNT_ID: accountId },
      readOutputs: async () => outputs,
      client: { api: async () => ({ subdomain: "test-account" }) },
      render: async (env) => {
        assert.equal(env.SAVIA_DOMAIN_D1_ID, "domain-id");
        events.push("render");
      },
      run: async (binary, args, options) => {
        if (binary === "git") return { stdout: "b".repeat(40) };
        assert.equal(binary, "pnpm");
        assert.match(
          options.env.VITE_PLUGIN_EDITOR_RUNTIME_URL,
          /test-account\.workers\.dev\/plugin-editor$/,
        );
        events.push(args.at(-1));
      },
      freeze: async (options) => {
        assert.equal(options.sourceRevision, "b".repeat(40));
        assert.equal(options.configs.length, 9);
        assert.ok(
          options.configs.some((path) =>
            path.endsWith("plugin-editor-runtime/wrangler.preview.jsonc"),
          ),
        );
        events.push("freeze");
        return { artifactDigest: "c".repeat(64) };
      },
    },
  );
  assert.deepEqual(events, [
    "render",
    "build:plugin-editor",
    "build:assets",
    "freeze",
  ]);
  assert.equal(result.sourceRevision, "b".repeat(40));
});
test("production preparation cannot build or read credentials outside reviewed main", async () => {
  await assert.rejects(
    prepareEnvironmentRelease(
      { environment: "production", destination: "/tmp/absent" },
      { env: {}, run: async () => assert.fail("spawned build") },
    ),
    /Production operations/,
  );
});
