import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  deploymentConfig,
  deployArtifacts,
  releaseArtifacts,
} from "./deploy-store-plugins.mjs";

test("private deployment config binds the selected D1 with existing Cloudflare credentials", () => {
  const env = {
    CLOUDFLARE_ACCOUNT_ID: "account",
    CLOUDFLARE_API_TOKEN: "private",
    CLOUDFLARE_DATABASE_ID: "database",
    SAVIA_DEPLOY_ENVIRONMENT: "preview",
  };
  const config = deploymentConfig(env, "one-run-secret");
  assert.equal(config.workers_dev, false);
  assert.equal(config.preview_urls, false);
  assert.equal(config.d1_databases[0].preview_database_id, "database");
  assert.equal(config.vars.DEPLOYMENT_SESSION, "one-run-secret");
  assert.ok(!JSON.stringify(config).includes('"private"'));
  assert.throws(
    () => deploymentConfig({ ...env, CLOUDFLARE_DATABASE_ID: "" }, "secret"),
    /CLOUDFLARE_DATABASE_ID/,
  );
  assert.throws(
    () =>
      deploymentConfig(
        { ...env, SAVIA_DEPLOY_ENVIRONMENT: "unknown" },
        "secret",
      ),
    /preview or production/,
  );
});

test("release folder packages configured sources and discovers ZIPs without tenant configuration", () => {
  const directory = mkdtempSync(join(tmpdir(), "savia-release-test-"));
  try {
    assert.deepEqual(releaseArtifacts(directory), []);
    writeFileSync(
      join(directory, "sources.json"),
      JSON.stringify({ ports: ["http-echo"] }),
    );
    const built = releaseArtifacts(directory);
    assert.equal(built.length, 1);
    assert.equal(built[0].manifest.id, "custom.http-echo");
    rmSync(join(directory, "sources.json"));
    assert.deepEqual(releaseArtifacts(directory), built);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("deploys and activates every release ZIP in all discovered workspaces", async () => {
  const directory = mkdtempSync(join(tmpdir(), "savia-deploy-test-"));
  const path = join(directory, "plugin.zip");
  writeFileSync(path, "fixture bytes");
  const calls = [];
  const artifacts = [
    { path, manifest: { id: "custom.demo", version: "1.0.0" } },
  ];
  try {
    const result = await deployArtifacts(
      artifacts,
      "http://127.0.0.1",
      "session",
      {
        log() {},
        fetch: async (url, init) => {
          calls.push({ url, init });
          assert.equal(init.headers.authorization, "Bearer session");
          return Response.json(
            url.endsWith("/tenants")
              ? { tenants: ["tenant:1", "agency:2", "domain:operations"] }
              : { data: {} },
          );
        },
      },
    );
    assert.deepEqual(result, { plugins: 1, tenants: 3 });
    assert.equal(calls.filter(({ url }) => url.includes("/upload?")).length, 3);
    assert.equal(
      calls.filter(({ url }) => url.includes("/install?")).length,
      3,
    );
    assert.ok(calls.every(({ url }) => !url.includes("update=enabled")));
    await assert.rejects(
      deployArtifacts(artifacts, "http://127.0.0.1", "session", {
        log() {},
        fetch: async () =>
          Response.json({ error: "conflict" }, { status: 409 }),
      }),
      /HTTP 409/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("release ZIP dependency ordering rejects cycles and duplicate plugin IDs", async () => {
  const { execFileSync } = await import("node:child_process");
  const directory = mkdtempSync(join(tmpdir(), "savia-release-order-"));
  const manifestPath = join(directory, "savia-extension.json");
  function zip(name, id, requires) {
    writeFileSync(
      manifestPath,
      JSON.stringify({ id, requires, version: "1.0.0" }),
    );
    execFileSync("zip", ["-q", "-j", join(directory, name), manifestPath]);
  }
  try {
    zip("a.zip", "custom.app", ["custom.base"]);
    zip("z.zip", "custom.base", []);
    assert.deepEqual(
      releaseArtifacts(directory).map(({ manifest }) => manifest.id),
      ["custom.base", "custom.app"],
    );
    zip("duplicate.zip", "custom.base", []);
    assert.throws(
      () => releaseArtifacts(directory),
      /Multiple deployment ZIPs/,
    );
    rmSync(join(directory, "duplicate.zip"));
    zip("z.zip", "custom.base", ["custom.app"]);
    assert.throws(
      () => releaseArtifacts(directory),
      /Circular plugin dependency/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
