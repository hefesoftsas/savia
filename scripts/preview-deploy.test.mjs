import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import {
  execFileWithInput,
  parseWorkersDevUrl,
  requireGatewayOrigin,
  workerConfig,
} from "./preview-deploy.mjs";

test("routes public quote reports through the preview gateway", () => {
  const config = workerConfig(
    "gateway",
    { workers: { gateway: "savia-preview-test" } },
    {},
    "https://savia-preview-test.workers.dev",
    { assetsDir: "/tmp/savia-admin-assets" },
  );

  assert.ok(config.assets.run_worker_first.includes("/public/quotes"));
  assert.ok(config.assets.run_worker_first.includes("/public/quotes/*"));
});

test("parses Cloudflare account-subdomain worker URLs", () => {
  assert.equal(
    parseWorkersDevUrl(
      "Uploaded https://savia-preview-test.account-123.workers.dev",
    ),
    "https://savia-preview-test.account-123.workers.dev",
  );
  assert.equal(
    parseWorkersDevUrl("Uploaded https://savia-preview-test.workers.dev"),
    "https://savia-preview-test.workers.dev",
  );
  assert.equal(parseWorkersDevUrl("Upload complete"), null);
});

test("requires a discovered origin after a real preview gateway deployment", () => {
  assert.equal(
    requireGatewayOrigin({ url: "https://preview.account.workers.dev" }, false),
    "https://preview.account.workers.dev",
  );
  assert.equal(requireGatewayOrigin({ url: null }, true), null);
  assert.throws(
    () => requireGatewayOrigin({ url: null }, false),
    /Could not determine preview origin/,
  );
});

test("writes provided stdin to the spawned command and closes it", async () => {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdout.setEncoding = () => {};
  child.stderr.setEncoding = () => {};
  let stdinText = "";
  let stdinEnded = false;
  child.stdin = {
    on() {},
    write(chunk) {
      stdinText += chunk;
    },
    end(chunk) {
      if (chunk !== undefined) stdinText += chunk;
      stdinEnded = true;
    },
  };
  const calls = [];
  const spawnImpl = (...args) => {
    calls.push(args);
    queueMicrotask(() => {
      child.stdout.emit("data", Buffer.from("wrangler ok"));
      child.emit("close", 0, null);
    });
    return child;
  };

  const result = await execFileWithInput(
    "pnpm",
    ["secret", "put", "ENCRYPTION_KEY"],
    { input: "secret-value", cwd: "/workspace/savia" },
    spawnImpl,
  );

  assert.equal(stdinText, "secret-value");
  assert.equal(stdinEnded, true);
  assert.equal(result.stdout, "wrangler ok");
  assert.equal(result.stderr, "");
  assert.equal(calls[0][0], "pnpm");
  assert.deepEqual(calls[0][1], ["secret", "put", "ENCRYPTION_KEY"]);
  assert.equal(calls[0][2].cwd, "/workspace/savia");
});

test("does not leave child stdin errors unhandled", async () => {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdout.setEncoding = () => {};
  child.stderr.setEncoding = () => {};
  child.stdin = new EventEmitter();
  child.stdin.end = () => {
    child.stdin.emit(
      "error",
      Object.assign(new Error("closed"), { code: "EPIPE" }),
    );
    queueMicrotask(() => child.emit("close", 1, null));
  };
  await assert.rejects(
    execFileWithInput(
      "pnpm",
      ["secret", "put"],
      { input: "secret" },
      () => child,
    ),
    /closed/,
  );
});
