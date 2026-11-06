import test from "node:test";
import assert from "node:assert/strict";
import { prepareEnvironmentRelease } from "./prepare-release.mjs";
import { resolveInfraNames } from "./naming.mjs";
test("standard preparation derives actual binding IDs and freezes the exact source", async () => {
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
      env: {
        CLOUDFLARE_ACCOUNT_ID: accountId,
        SAVIA_PREVIEW_RELEASE_BASE: "a".repeat(40),
      },
      readOutputs: async () => outputs,
      client: { api: async () => ({ subdomain: "test-account" }) },
      render: async (env) => {
        assert.equal(env.SAVIA_DOMAIN_D1_ID, "domain-id");
        events.push("render");
      },
      run: async (binary, args, options) => {
        if (binary === "git")
          return {
            stdout:
              args[0] === "rev-parse"
                ? "b".repeat(40)
                : args[0] === "diff"
                  ? "apps/api/src/auth/admin-oauth.ts"
                  : args[0] === "show"
                    ? "export const x = 1"
                    : "",
          };
        assert.equal(binary, "pnpm");
        assert.match(
          options.env.VITE_PLUGIN_EDITOR_RUNTIME_URL,
          /test-account\.workers\.dev\/plugin-editor$/,
        );
        events.push(args.at(-1));
      },
      freeze: async (options) => {
        assert.equal(options.sourceRevision, "b".repeat(40));
        assert.deepEqual(options.codeOnly, {
          base: "a".repeat(40),
          head: "b".repeat(40),
          targets: ["api"],
        });
        assert.equal(options.configs.length, 1);
        assert.ok(
          options.configs[0].endsWith("apps/api/wrangler.preview.jsonc"),
        );
        events.push("freeze");
        return { artifactDigest: "c".repeat(64) };
      },
    },
  );
  assert.deepEqual(events, ["render", "freeze"]);
  assert.equal(result.sourceRevision, "b".repeat(40));
});

test("verified Preview code scope is selected before builds and freezes only its Worker targets", async () => {
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
  await prepareEnvironmentRelease(
    { environment: "preview", destination: "/tmp/not-created-code-only" },
    {
      env: {
        CLOUDFLARE_ACCOUNT_ID: accountId,
        SAVIA_PREVIEW_RELEASE_BASE: "a".repeat(40),
      },
      readOutputs: async () => outputs,
      client: {
        api: async () => assert.fail("code-only scope read account API"),
      },
      render: async () => events.push("render"),
      run: async (binary, args) => {
        if (binary === "git") {
          if (args[0] === "rev-parse") return { stdout: "b".repeat(40) };
          if (args[0] === "merge-base") return { stdout: "" };
          if (args[0] === "diff")
            return { stdout: "apps/api/src/auth/admin-oauth.ts" };
          if (args[0] === "show") return { stdout: "export const x = 1" };
        }
        events.push(`build:${args.at(-1)}`);
        return { stdout: "" };
      },
      freeze: async (options) => {
        assert.deepEqual(options.codeOnly, {
          base: "a".repeat(40),
          head: "b".repeat(40),
          targets: ["api"],
        });
        assert.deepEqual(
          options.configs.map((path) => path.split("/").slice(-2).join("/")),
          ["api/wrangler.preview.jsonc"],
        );
        assert.ok(options.domainMigrations.endsWith("packages/db/migrations"));
        events.push("freeze");
        return { artifactDigest: "c".repeat(64) };
      },
    },
  );
  assert.deepEqual(events, ["render", "freeze"]);
});

test("frontend Preview scope builds both frontends and freezes only their configs", async () => {
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
  await prepareEnvironmentRelease(
    { environment: "preview", destination: "/tmp/not-created-code-only" },
    {
      env: {
        CLOUDFLARE_ACCOUNT_ID: accountId,
        SAVIA_PREVIEW_RELEASE_BASE: "a".repeat(40),
      },
      readOutputs: async () => outputs,
      client: {
        api: async () => ({ subdomain: "test-account" }),
      },
      render: async () => events.push("render"),
      run: async (binary, args) => {
        if (binary === "git") {
          if (args[0] === "rev-parse") return { stdout: "b".repeat(40) };
          if (args[0] === "merge-base") return { stdout: "" };
          if (args[0] === "diff")
            return { stdout: "apps/admin/src/i18n/locales/savia.ts" };
          if (args[0] === "show") return { stdout: "export const x = 1" };
        }
        events.push(`build:${args.at(-1)}`);
        return { stdout: "" };
      },
      freeze: async (options) => {
        assert.deepEqual(options.codeOnly, {
          base: "a".repeat(40),
          head: "b".repeat(40),
          targets: ["pluginEditor", "gateway"],
        });
        assert.deepEqual(
          options.configs.map((path) => path.split("/").slice(-2).join("/")),
          [
            "admin/wrangler.preview.jsonc",
            "plugin-editor-runtime/wrangler.preview.jsonc",
          ],
        );
        assert.ok(options.domainMigrations.endsWith("packages/db/migrations"));
        events.push("freeze");
        return { artifactDigest: "c".repeat(64) };
      },
    },
  );
  assert.deepEqual(events, [
    "render",
    "build:build:plugin-editor",
    "build:build:assets",
    "freeze",
  ]);
});

test("a Preview full-release fallback still builds assets and freezes the full Worker set", async () => {
  const accountId = "a".repeat(32),
    names = resolveInfraNames({
      environment: "preview",
      documentsBucket: "savia-documents-preview",
      publicOrigin: "https://savia-preview.hefesoft.com",
    }),
    events = [];
  await prepareEnvironmentRelease(
    { environment: "preview", destination: "/tmp/not-created-full-release" },
    {
      env: {
        CLOUDFLARE_ACCOUNT_ID: accountId,
        SAVIA_PREVIEW_RELEASE_BASE: "a".repeat(40),
      },
      readOutputs: async () => ({
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
      }),
      client: { api: async () => ({ subdomain: "test-account" }) },
      render: async () => events.push("render"),
      run: async (binary, args) => {
        if (binary === "git")
          return {
            stdout:
              args[0] === "rev-parse"
                ? "b".repeat(40)
                : args[0] === "diff"
                  ? "apps/api/src/auth/admin-oauth.ts"
                  : args[0] === "show"
                    ? "CREATE TABLE incompatible_change (id INTEGER)"
                    : "",
          };
        events.push(args.at(-1));
        return { stdout: "" };
      },
      freeze: async (options) => {
        assert.equal(options.codeOnly, undefined);
        assert.equal(options.configs.length, 9);
        events.push("freeze");
        return { artifactDigest: "c".repeat(64) };
      },
    },
  );
  assert.ok(events.includes("build:plugin-editor"));
  assert.ok(events.includes("build:assets"));
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
