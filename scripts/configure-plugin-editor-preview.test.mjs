import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  configurePluginEditorPreview,
  validateDeploymentUrl,
} from "./configure-plugin-editor-preview.mjs";

const goodUrl = "https://savia-plugin-editor-preview.account-123.workers.dev";
const goodHeaders = {
  "content-type": "text/html; charset=utf-8",
  "content-security-policy":
    "default-src 'none'; frame-ancestors https://savia-preview.hefesoft.com",
};

function response({
  status = 200,
  headers = goodHeaders,
  url = `${goodUrl}/plugin-editor`,
} = {}) {
  return new Response("<!doctype html>", { status, headers, url });
}

function temporaryEnvFile() {
  const directory = mkdtempSync(join(tmpdir(), "plugin-editor-preview-"));
  return { directory, path: join(directory, "github-env") };
}

test("accepts only the dedicated HTTPS workers.dev deployment origin", () => {
  assert.equal(validateDeploymentUrl(goodUrl).origin, goodUrl);
  for (const value of [
    "http://savia-plugin-editor-preview.account.workers.dev",
    "https://savia-preview.hefesoft.com",
    "https://savia-plugin-editor-preview.account.workers.dev.evil.test",
    "https://savia-plugin-editor-preview.account.workers.dev/path",
    "https://user@savia-plugin-editor-preview.account.workers.dev",
    "https://savia-plugin-editor-preview.account.workers.dev?x=1",
  ]) {
    assert.throws(() => validateDeploymentUrl(value));
  }
});

test("waits for an isolated runtime response before writing the admin URL", async () => {
  const envFile = temporaryEnvFile();
  try {
    const configured = await configurePluginEditorPreview({
      deploymentUrl: goodUrl,
      githubEnvPath: envFile.path,
      fetchImpl: async (url, options) => {
        assert.equal(url.toString(), `${goodUrl}/plugin-editor`);
        assert.deepEqual(options, { redirect: "error" });
        return response();
      },
    });
    assert.equal(configured, `${goodUrl}/plugin-editor`);
    assert.equal(
      readFileSync(envFile.path, "utf8"),
      `VITE_PLUGIN_EDITOR_RUNTIME_URL=${goodUrl}/plugin-editor\n`,
    );
  } finally {
    rmSync(envFile.directory, { recursive: true, force: true });
  }
});

test("does not write the admin URL until readiness headers pass", async () => {
  const envFile = temporaryEnvFile();
  try {
    await assert.rejects(
      configurePluginEditorPreview({
        deploymentUrl: goodUrl,
        githubEnvPath: envFile.path,
        fetchImpl: async () =>
          response({
            headers: { ...goodHeaders, "set-cookie": "session=secret" },
          }),
      }),
      /must not set cookies/,
    );
    assert.throws(() => readFileSync(envFile.path, "utf8"), { code: "ENOENT" });

    await assert.rejects(
      configurePluginEditorPreview({
        deploymentUrl: goodUrl,
        githubEnvPath: envFile.path,
        fetchImpl: async () =>
          response({ headers: { "content-type": "text/html" } }),
      }),
      /missing its isolation policy/,
    );
    assert.throws(() => readFileSync(envFile.path, "utf8"), { code: "ENOENT" });
  } finally {
    rmSync(envFile.directory, { recursive: true, force: true });
  }
});

test("preview workflow deploys the isolated runtime before enabling the admin build", () => {
  const workflow = readFileSync(
    new URL("../.github/workflows/deploy-preview.yml", import.meta.url),
    "utf8",
  );
  const runtimeBuild = workflow.indexOf(
    "pnpm --filter @savia/admin run build:plugin-editor",
  );
  const runtimeDeploy = workflow.indexOf("id: plugin_editor");
  const runtimeConfigure = workflow.indexOf(
    "node scripts/configure-plugin-editor-preview.mjs",
  );
  const adminBuild = workflow.indexOf(
    "pnpm --filter @savia/admin run build:assets",
  );
  assert.ok(
    runtimeBuild >= 0 &&
      runtimeDeploy > runtimeBuild &&
      runtimeConfigure > runtimeDeploy &&
      adminBuild > runtimeConfigure,
  );
  assert.match(workflow, /deployment-url/);
  assert.match(
    workflow,
    /workingDirectory: apps\/api[\s\S]*?command: deploy --config \.\.\/plugin-editor-runtime\/wrangler\.jsonc/,
  );
});

test("preview runtime has only a static asset binding and no application secrets or API routes", () => {
  const config = JSON.parse(
    readFileSync(
      new URL("../apps/plugin-editor-runtime/wrangler.jsonc", import.meta.url),
      "utf8",
    ).replace(/,\s*([}\]])/g, "$1"),
  );
  assert.deepEqual(Object.keys(config).sort(), [
    "assets",
    "compatibility_date",
    "main",
    "name",
    "workers_dev",
  ]);
  assert.equal(config.name, "savia-plugin-editor-preview");
  assert.equal(config.workers_dev, true);
  assert.equal(config.assets.binding, "ASSETS");
  assert.equal(config.assets.run_worker_first, true);
  assert.equal(config.assets.not_found_handling, "none");
});
