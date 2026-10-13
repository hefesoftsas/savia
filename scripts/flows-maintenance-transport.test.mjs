import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { EventEmitter } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { startPreviewMaintenanceTransport } from "./flows-maintenance-transport.mjs";

const ACCOUNT_ID = "0123456789abcdef0123456789abcdef";
const ENV = {
  SAVIA_DEPLOY_ENVIRONMENT: "preview",
  CLOUDFLARE_ACCOUNT_ID: ACCOUNT_ID,
  CLOUDFLARE_API_TOKEN: "test-cloudflare-token",
};

async function fixture() {
  const root = await mkdtemp(
    join(tmpdir(), "flows-maintenance-transport-test-"),
  );
  return { root, configPath: join(root, "wrangler.json") };
}

function fakeChild() {
  const child = new EventEmitter();
  child.pid = 999999999;
  child.exitCode = null;
  child.signalCode = null;
  child.kill = () => {
    child.exitCode = 0;
    setImmediate(() => child.emit("exit", 0, "SIGTERM"));
  };
  return child;
}

test("starts a preview-only, loopback session with fixed binding and removes its private config on close", async (t) => {
  const files = await fixture();
  t.after(() => rm(files.root, { recursive: true, force: true }));
  let child;
  let command;
  let configPath;
  const forwarded = [];
  const transport = await startPreviewMaintenanceTransport({
    env: ENV,
    createTempDir: async () => files.root,
    removeTempDir: (path) => rm(path, { recursive: true, force: true }),
    reservePort: async () => 18876,
    spawnImpl: (...args) => {
      [command] = args;
      configPath = args[1][args[1].indexOf("--config") + 1];
      child = fakeChild();
      return child;
    },
    fetchImpl: async (url, options) => {
      const authorization = new Headers(options.headers).get("authorization");
      assert.match(authorization, /^Bearer [A-Za-z0-9_-]{40,}$/);
      if (url.endsWith("/__session/health")) {
        assert.equal(url, "http://127.0.0.1:18876/__session/health");
        return Response.json({ ready: true });
      }
      forwarded.push({ url, options });
      return Response.json({ success: true });
    },
  });
  assert.equal(command, "pnpm");
  assert.equal(child.pid, 999999999);
  const config = JSON.parse(await readFile(configPath, "utf8"));
  assert.equal(config.workers_dev, false);
  assert.equal(config.preview_urls, false);
  assert.deepEqual(config.services, [
    { binding: "SAVIA_HOST", service: "savia-agencies-preview" },
  ]);
  assert.equal(config.routes, undefined);
  assert.equal(config.vars.SESSION_TOKEN.length >= 40, true);
  assert.equal((await stat(files.root)).mode & 0o777, 0o700);
  assert.equal((await stat(configPath)).mode & 0o777, 0o600);

  await transport.fetchImpl(
    "https://savia-preview.hefesoft.com/api/public/savia-flows/maintenance",
    {
      method: "POST",
      headers: { "x-savia-flows-maintenance": "signed-token" },
      body: JSON.stringify({ action: "status" }),
    },
  );
  assert.equal(
    forwarded[0].url,
    "http://127.0.0.1:18876/api/public/savia-flows/maintenance",
  );
  assert.match(forwarded[0].options.headers.get("authorization"), /^Bearer /);
  await transport.close();
  assert.equal(child.exitCode, 0);
  await assert.rejects(readFile(configPath));
});

test("rejects production and missing credentials before spawning Wrangler", async () => {
  let spawns = 0;
  const options = {
    spawnImpl: () => (spawns++, fakeChild()),
    reservePort: async () => 18876,
  };
  await assert.rejects(
    startPreviewMaintenanceTransport({
      ...options,
      env: { ...ENV, SAVIA_DEPLOY_ENVIRONMENT: "production" },
    }),
    /preview-only/,
  );
  await assert.rejects(
    startPreviewMaintenanceTransport({
      ...options,
      env: { ...ENV, CLOUDFLARE_ACCOUNT_ID: "not-an-account" },
    }),
    /ACCOUNT_ID/,
  );
  await assert.rejects(
    startPreviewMaintenanceTransport({
      ...options,
      env: { ...ENV, CLOUDFLARE_API_TOKEN: "" },
    }),
    /API_TOKEN/,
  );
  assert.equal(spawns, 0);
});

test("cleans the session directory when authenticated startup never becomes ready", async (t) => {
  const files = await fixture();
  t.after(() => rm(files.root, { recursive: true, force: true }));
  let child;
  let now = 1_000;
  await assert.rejects(
    startPreviewMaintenanceTransport({
      env: ENV,
      createTempDir: async () => files.root,
      removeTempDir: (path) => rm(path, { recursive: true, force: true }),
      reservePort: async () => 18876,
      spawnImpl: () => {
        child = fakeChild();
        return child;
      },
      fetchImpl: async () => Response.json({ ready: false }),
      now: () => now,
      sleepImpl: async (milliseconds) => {
        now += milliseconds;
      },
    }),
    /failed to start/,
  );
  assert.equal(child.exitCode, 0);
  await assert.rejects(readFile(files.configPath));
});
