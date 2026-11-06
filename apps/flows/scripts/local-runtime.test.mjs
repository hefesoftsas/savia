import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createLocalOptions,
  createLocalRuntime,
  createManagedLocalRuntime,
} from "./local-runtime.mjs";

const require = createRequire(new URL("../api/package.json", import.meta.url));
const { experimental_readRawConfig } = require("wrangler");

test("retained provider test profiles cannot activate external services", async () => {
  for (const profile of ["integration", "evaluation", "probe", "benchmark"]) {
    const config = await readFile(
      new URL(`../api/vitest.${profile}.config.mts`, import.meta.url),
      "utf8",
    );
    assert.match(config, /^throw new Error\(/);
    assert.match(config, /disabled in the local Savia Flows edition/);
  }
  for (const profile of ["integration", "evaluation", "test"]) {
    const config = await readFile(
      new URL(`../api/wrangler.${profile}.jsonc`, import.meta.url),
      "utf8",
    );
    assert.doesNotMatch(config, /"remote"\s*:\s*true/);
    assert.doesNotMatch(config, /"ai"\s*:/);
  }
  const drizzle = await readFile(
    new URL("../api/drizzle.config.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(drizzle, /dbCredentials|d1-http|CLOUDFLARE_API_TOKEN/);
  const apiPackage = JSON.parse(
    await readFile(new URL("../api/package.json", import.meta.url), "utf8"),
  );
  assert.doesNotMatch(
    JSON.stringify(apiPackage.scripts),
    /deploy|--remote|test:integration|eval:|benchmark:/,
  );
});

test("local runtime denies external and loopback HTTP even without provider credentials", async () => {
  const runtime = await createLocalRuntime({
    script: `export default {fetch(req) {return fetch(new URL(req.url).searchParams.get('target'))}}`,
    persist: false,
    port: 0,
    minimal: true,
  });
  try {
    for (const url of [
      "https://api.openai.com/v1/models",
      "http://127.0.0.1:8787/health",
    ]) {
      const response = await runtime.dispatchFetch(
        "http://local.test/?target=" + encodeURIComponent(url),
      );
      assert.equal(response.status, 503);
      assert.equal(
        (await response.json()).error.code,
        "EXTERNAL_SERVICES_DISABLED",
      );
    }
  } finally {
    await runtime.dispose();
  }
});

test("local D1 and R2 survive restarting the runtime in the same persistence directory", async () => {
  const directory = await mkdtemp(join(tmpdir(), "savia-flows-persistence-"));
  const script = `export default {async fetch(request, env) {
    if (request.method === 'POST') {
      await env.DB.exec('CREATE TABLE IF NOT EXISTS proof (value TEXT)');
      await env.DB.prepare('INSERT INTO proof VALUES (?)').bind('saved flow').run();
      await env.RESSOURCES.put('proof', 'saved result');
    }
    return Response.json({row:await env.DB.prepare('SELECT value FROM proof').first(), object:await (await env.RESSOURCES.get('proof')).text()});
  }}`;
  try {
    let runtime = await createLocalRuntime({
      script,
      persist: directory,
      port: 0,
      minimal: true,
    });
    const written = await runtime.dispatchFetch("http://local.test/", {
      method: "POST",
    });
    assert.equal(written.status, 200);
    await runtime.dispose();
    runtime = await createLocalRuntime({
      script,
      persist: directory,
      port: 0,
      minimal: true,
    });
    try {
      const result = await (
        await runtime.dispatchFetch("http://local.test/")
      ).json();
      assert.deepEqual(result, {
        row: { value: "saved flow" },
        object: "saved result",
      });
    } finally {
      await runtime.dispose();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("local options do not import cloud credentials or remote service bindings", () => {
  process.env.CLOUDFLARE_API_TOKEN = "must-not-reach-worker";
  try {
    const options = createLocalOptions({
      script: "export default {fetch(){return new Response('ok')}}",
      persist: false,
      port: 0,
    });
    const encoded = JSON.stringify(options);
    assert.equal(encoded.includes("must-not-reach-worker"), false);
    assert.equal(encoded.includes("remoteProxyConnectionString"), false);
    assert.equal(encoded.includes("remoteBindings"), false);
    assert.equal(options.workers[0].bindings.SAVIA_FLOWS_LOCAL_ONLY, "true");
    assert.equal(
      options.workers[0].serviceBindings.CODE_EXECUTOR.entrypoint,
      "FlowsExecutor",
    );
  } finally {
    delete process.env.CLOUDFLARE_API_TOKEN;
  }
});

test("runnable Flows configs bind QuickJS and contain no WorkerLoader", async () => {
  for (const profile of ["", ".test", ".integration", ".evaluation"]) {
    const configPath = fileURLToPath(
      new URL(`../api/wrangler${profile}.jsonc`, import.meta.url),
    );
    const { rawConfig } = experimental_readRawConfig({ config: configPath });
    assert.deepEqual(rawConfig.services, [
      {
        binding: "CODE_EXECUTOR",
        service: "savia-hook-executor",
        entrypoint: "FlowsExecutor",
      },
    ]);
    assert.equal(Object.hasOwn(rawConfig, "worker_loaders"), false);
  }
});

test("public form links use the selected local Admin port", () => {
  const options = createLocalOptions({ publicOrigin: "http://127.0.0.1:5183" });
  assert.equal(
    options.workers[0].bindings.WEB_HOST,
    "http://127.0.0.1:5183/flows-ui",
  );
  assert.throws(
    () => createLocalOptions({ publicOrigin: "https://external.example" }),
    /loopback/,
  );
});

test(
  "private service bindings resolve bidirectionally across separate local runtimes",
  { timeout: 15_000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "savia-flows-registry-"));
    const registryPath = join(directory, "registry");
    const script = `export default {async fetch(request,env) {
    if(new URL(request.url).pathname === '/ping') return new Response(env.LABEL);
    return env.PEER.fetch('http://local-peer.internal/ping');
  }}`;
    const optionsA = createLocalOptions({
      script,
      port: 0,
      minimal: true,
      registryPath,
      workerOptions: {
        bindings: { LABEL: "A" },
        serviceBindings: { PEER: "savia-flows-peer" },
      },
    });
    const optionsB = createLocalOptions({
      script,
      port: 0,
      minimal: true,
      registryPath,
      workerOptions: {
        bindings: { LABEL: "B" },
        serviceBindings: { PEER: "savia-flows" },
      },
    });
    optionsB.workers[0].name = "savia-flows-peer";
    const a = createManagedLocalRuntime(optionsA);
    const b = createManagedLocalRuntime(optionsB);
    try {
      await Promise.all([a.ready, b.ready]);
      for (const [runtime, expected] of [
        [a, "B"],
        [b, "A"],
      ]) {
        const deadline = Date.now() + 5000;
        let value;
        while (Date.now() < deadline) {
          const response = await runtime.dispatchFetch(
            "http://local.test/peer",
          );
          value = await response.text();
          if (response.ok && value === expected) break;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        assert.equal(value, expected);
      }
    } finally {
      await Promise.all([a.dispose(), b.dispose()]);
      await rm(directory, { recursive: true, force: true });
    }
  },
);
