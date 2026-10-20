import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, writeFile, rm, access } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  initializeAuthDeployment,
  validateAuthDeployment,
} from "./initialize-auth-deployment.mjs";

const revision = "a".repeat(40);
const config = {
  name: "savia-auth-preview",
  vars: { SAVIA_AUTH_DEPLOYMENT_REVISION: revision },
  d1_databases: [
    {
      binding: "AUTH_DB",
      database_id: "auth-id",
      database_name: "savia-auth-preview",
    },
  ],
};
const env = {
  CLOUDFLARE_ACCOUNT_ID: "b".repeat(32),
  SAVIA_DEPLOY_ENVIRONMENT: "preview",
  SAVIA_AUTH_D1_ID: "auth-id",
  SAVIA_AUTH_D1_NAME: "savia-auth-preview",
};
for (const key of [
  "BETTER_AUTH_SECRET",
  "SAVIA_MCP_SHARED_SECRET",
  "SAVIA_REQUEST_ENCRYPTION_KEY",
  "EXTENSION_CONNECTIONS_ENCRYPTION_KEY",
  "ASSISTANT_SETTINGS_ENCRYPTION_KEY",
  "STUDIO_INTEGRATION_KEY",
  "NANGO_API_KEY",
])
  env[key] = "SECRET_CANARY";

test("initialization rejects mismatched environment, account, database and source before starting a session", () => {
  assert.deepEqual(validateAuthDeployment("preview", config, env), {
    service: "savia-auth-preview",
    revision,
  });
  for (const changed of [
    { ...config, name: "savia-auth" },
    { ...config, account_id: "c".repeat(32) },
    { ...config, vars: {} },
    { ...config, d1_databases: [] },
  ])
    assert.throws(
      () => validateAuthDeployment("preview", changed, env),
      /mismatch/,
    );
  assert.throws(
    () => validateAuthDeployment("production", config, env),
    /mismatch/,
  );
  assert.throws(
    () =>
      validateAuthDeployment("production", config, {
        ...env,
        SAVIA_DEPLOY_ENVIRONMENT: "production",
      }),
    /Production operations are disabled/,
  );
});

test("deployment initializes only its bound revision, validates readiness and removes temporary config", async () => {
  const directory = await mkdtemp(join(tmpdir(), "auth-initialize-test-"));
  const configPath = join(directory, "auth.json");
  await writeFile(configPath, JSON.stringify(config));
  try {
    for (const valid of [true, false]) {
      let probeConfig, probePath;
      const requests = [];
      const result = initializeAuthDeployment(
        { environment: "preview", configPath },
        {
          env,
          start: (binary, args, options) => {
            assert.match(binary, /wrangler$/);
            assert.ok(args.includes("--remote"));
            assert.deepEqual(options.stdio, ["ignore", "pipe", "pipe"]);
            probePath = args[args.indexOf("--config") + 1];
            const source = readFileSync(probePath, "utf8");
            assert.doesNotMatch(source, /SECRET_CANARY|x-savia-bridge-key/);
            probeConfig = JSON.parse(source);
            assert.deepEqual(probeConfig.services, [
              { binding: "AUTH", service: "savia-auth-preview" },
            ]);
            return new EventEmitter();
          },
          request: async (url, options) => {
            requests.push({ url, options });
            if (url.endsWith("/ready"))
              return Response.json({ nonce: probeConfig.vars.PROBE_NONCE });
            assert.equal(
              options.headers["x-savia-probe-nonce"],
              probeConfig.vars.PROBE_NONCE,
            );
            assert.match(
              options.headers["x-savia-bridge-key"],
              /^[a-f\d]{64}$/,
            );
            return Response.json({
              status: "ready",
              revision: valid ? revision : "c".repeat(40),
            });
          },
        },
      );
      if (valid) assert.deepEqual(await result, { status: "ready", revision });
      else await assert.rejects(result, /readiness mismatch/);
      assert.equal(requests.length, 2);
      await assert.rejects(access(probePath), /ENOENT/);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("failed remote session preserves private diagnostics and reports a safe stage", async () => {
  const directory = await mkdtemp(join(tmpdir(), "auth-session-failure-"));
  const configPath = join(directory, "auth.json");
  await writeFile(configPath, JSON.stringify(config));
  const stages = [];
  try {
    await assert.rejects(
      initializeAuthDeployment(
        { environment: "preview", configPath },
        {
          env: { ...env, SAVIA_RUNTIME_OPERATION_DIRECTORY: directory },
          report: (stage) => stages.push(stage),
          start: () => {
            const child = new EventEmitter();
            child.stdout = new EventEmitter();
            child.stderr = new EventEmitter();
            queueMicrotask(() => {
              child.stderr.emit("data", Buffer.from("PRIVATE_SESSION_FAILURE"));
              child.emit("exit", 1);
            });
            return child;
          },
          request: async () => new Response(null, { status: 503 }),
        },
      ),
      /session unavailable/,
    );
    const { readdir, readFile } = await import("node:fs/promises");
    const records = await readdir(join(directory, "command-errors"));
    assert.equal(records.length, 1);
    const record = JSON.parse(
      await readFile(join(directory, "command-errors", records[0]), "utf8"),
    );
    assert.match(record.stderr, /PRIVATE_SESSION_FAILURE/);
    assert.equal(record.exitcode, 1);
    assert.match(stages.join("\n"), /session/);
    assert.doesNotMatch(
      stages.join("\n"),
      /PRIVATE_SESSION_FAILURE|SECRET_CANARY/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
