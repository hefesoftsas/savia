import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pluginEditorWorkerConfig } from "../infra/pulumi/auxiliary-worker-config.mjs";
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
        assert.equal(options.redirect, "error");
        assert.ok(options.signal instanceof AbortSignal);
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

test("retries transient deployment propagation failures before configuring admin", async () => {
  const envFile = temporaryEnvFile();
  const sleeps = [];
  let attempts = 0;
  try {
    const configured = await configurePluginEditorPreview({
      deploymentUrl: goodUrl,
      githubEnvPath: envFile.path,
      sleepImpl: async (milliseconds) => sleeps.push(milliseconds),
      fetchImpl: async () => {
        attempts += 1;
        if (attempts === 1) return response({ status: 404 });
        if (attempts === 2) return response({ status: 503 });
        return response();
      },
    });

    assert.equal(configured, `${goodUrl}/plugin-editor`);
    assert.equal(attempts, 3);
    assert.equal(sleeps.length, 2);
    assert.ok(sleeps.every((milliseconds) => milliseconds > 0));
  } finally {
    rmSync(envFile.directory, { recursive: true, force: true });
  }
});

test("retries network failures but fails closed immediately on nontransient or unsafe responses", async () => {
  const envFile = temporaryEnvFile();
  let networkAttempts = 0;
  const sleeps = [];
  try {
    await configurePluginEditorPreview({
      deploymentUrl: goodUrl,
      githubEnvPath: envFile.path,
      sleepImpl: async (milliseconds) => sleeps.push(milliseconds),
      fetchImpl: async () => {
        networkAttempts += 1;
        if (networkAttempts === 1) throw new Error("connection reset");
        return response();
      },
    });
    assert.equal(networkAttempts, 2);
    assert.equal(sleeps.length, 1);

    let unauthorizedAttempts = 0;
    await assert.rejects(
      configurePluginEditorPreview({
        deploymentUrl: goodUrl,
        githubEnvPath: envFile.path,
        sleepImpl: async () => assert.fail("must not retry HTTP 401"),
        fetchImpl: async () => {
          unauthorizedAttempts += 1;
          return response({ status: 401 });
        },
      }),
      /readiness returned HTTP 401/,
    );
    assert.equal(unauthorizedAttempts, 1);

    let unsafeAttempts = 0;
    await assert.rejects(
      configurePluginEditorPreview({
        deploymentUrl: goodUrl,
        githubEnvPath: envFile.path,
        sleepImpl: async () => assert.fail("must not retry an unsafe response"),
        fetchImpl: async () => {
          unsafeAttempts += 1;
          return response({ headers: { "content-type": "text/html" } });
        },
      }),
      /missing its isolation policy/,
    );
    assert.equal(unsafeAttempts, 1);
  } finally {
    rmSync(envFile.directory, { recursive: true, force: true });
  }
});

test("bounds retries and does not configure admin when the runtime never becomes ready", async () => {
  const envFile = temporaryEnvFile();
  let attempts = 0;
  const sleeps = [];
  try {
    await assert.rejects(
      configurePluginEditorPreview({
        deploymentUrl: goodUrl,
        githubEnvPath: envFile.path,
        sleepImpl: async (milliseconds) => sleeps.push(milliseconds),
        fetchImpl: async () => {
          attempts += 1;
          return response({ status: 504 });
        },
      }),
      /readiness returned HTTP 504 after 12 attempts/,
    );
    assert.equal(attempts, 12);
    assert.equal(sleeps.length, 11);
    assert.throws(() => readFileSync(envFile.path, "utf8"), {
      code: "ENOENT",
    });
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

test("managed publication verifies the isolated editor before exposing the new gateway", async () => {
  const { standardReleaseCommands } =
    await import("../infra/pulumi/runtime-publisher-standard.mjs");
  const plan = standardReleaseCommands({
    environment: "preview",
    configs: {
      api: "/f/api.json",
      auth: "/f/auth.json",
      pluginEditor: "/f/editor.json",
      gateway: "/f/gateway.json",
    },
    recoveryDirectory: "/private/recovery",
  });
  const editor = plan.deploy.findIndex(
      (step) => step.worker === "pluginEditor",
    ),
    verify = plan.deploy.findIndex(
      (step) => step.kind === "plugin-editor-verify",
    ),
    gateway = plan.deploy.findIndex((step) => step.worker === "gateway");
  assert.ok(editor >= 0 && verify > editor && gateway > verify);
  const workflow = readFileSync(
    new URL("../.github/workflows/deploy-preview.yml", import.meta.url),
    "utf8",
  );
  assert.match(workflow, /prepare-release\.mjs --environment preview/);
  assert.match(workflow, /environment\.mjs apply --environment preview/);
});

test("preview runtime has only a static asset binding and no application secrets or API routes", () => {
  const config = pluginEditorWorkerConfig();
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
