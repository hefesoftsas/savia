import { randomBytes } from "node:crypto";
import {
  closeSync,
  fchmodSync,
  fsyncSync,
  openSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { deploymentConfig } from "./deploy-store-plugins.mjs";
import { packageStorePlugin } from "./pack-store-plugin.mjs";

const root = resolve(import.meta.dirname, "..");
const workerMain = join(root, "scripts/plugin-preview-deployment/worker.ts");

function fail(message) {
  throw new Error(`Preview plugin publication failed: ${message}`);
}

export function validatePluginPlan(plan) {
  if (!plan || plan.kind !== "plugin" || !Array.isArray(plan.plugins))
    fail("plan must be a plugin plan with a plugins array.");
  if (plan.plugins.length === 0) fail("plan contains no plugins.");
  const ids = new Set();
  for (const plugin of plan.plugins) {
    if (
      !plugin ||
      typeof plugin.directory !== "string" ||
      !/^(?:packages\/plugin-[a-z0-9-]+|store-ports\/[a-z0-9-]+)$/.test(
        plugin.directory,
      ) ||
      typeof plugin.id !== "string" ||
      !/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/.test(plugin.id) ||
      typeof plugin.version !== "string" ||
      !/^\d+\.\d+\.\d+$/.test(plugin.version) ||
      typeof plugin.previousVersion !== "string" ||
      !/^\d+\.\d+\.\d+$/.test(plugin.previousVersion)
    )
      fail("plan contains an invalid plugin entry.");
    if (ids.has(plugin.id)) fail(`plan repeats plugin ${plugin.id}.`);
    ids.add(plugin.id);
  }
  return plan;
}

export function packagePlanPlugins(plan, options = {}) {
  validatePluginPlan(plan);
  const pack = options.pack ?? packageStorePlugin;
  const temporary =
    options.temporary ?? mkdtempSync(join(tmpdir(), "savia-preview-plugin-"));
  const artifacts = [];
  try {
    for (const plugin of plan.plugins) {
      const portDir = resolve(root, plugin.directory);
      if (!portDir.startsWith(`${root}${sep}`))
        fail("plugin path escaped repository root.");
      const packed = pack({
        portDir: plugin.directory,
        outputPath: join(temporary, `${plugin.id}-${plugin.version}.zip`),
      });
      if (
        packed.manifest.id !== plugin.id ||
        packed.manifest.version !== plugin.version
      )
        fail(`package does not match plan for ${plugin.id}@${plugin.version}.`);
      const manifestPath = join(portDir, "savia-extension.json");
      const manifestSource = JSON.parse(readFileSync(manifestPath, "utf8"));
      manifestSource.version = packed.manifest.version;
      let storeJson = null;
      try {
        storeJson = JSON.parse(
          readFileSync(join(portDir, "store.json"), "utf8"),
        );
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
      artifacts.push({
        ...plugin,
        manifest: manifestSource,
        storeJson,
        sha256: packed.sha256,
        path: resolve(root, packed.artifactPath),
      });
    }
  } catch (error) {
    rmSync(temporary, { recursive: true, force: true });
    throw error;
  }
  return { temporary, artifacts };
}

function writeRecoveryFile(path, checkpoint) {
  const descriptor = openSync(path, "wx", 0o600);
  try {
    fchmodSync(descriptor, 0o600);
    writeFileSync(descriptor, `${JSON.stringify(checkpoint, null, 2)}\n`);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  const directoryDescriptor = openSync(dirname(path), "r");
  try {
    fsyncSync(directoryDescriptor);
  } finally {
    closeSync(directoryDescriptor);
  }
}

async function workerCall(baseUrl, session, route, init = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    ...init,
    redirect: "error",
    signal: AbortSignal.timeout(120_000),
    headers: {
      ...init.headers,
      authorization: `Bearer ${session}`,
    },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(
      `${route} returned HTTP ${response.status}: ${JSON.stringify(payload?.error ?? payload ?? "unavailable")}`,
    );
  return payload;
}

export async function publishPlan(
  plan,
  artifacts,
  recoveryPath,
  baseUrl,
  session,
  io = {},
) {
  validatePluginPlan(plan);
  if (!Array.isArray(artifacts) || artifacts.length !== plan.plugins.length)
    fail("packaged artifacts do not match the approved plan.");
  const call = io.call ?? workerCall;
  const checkpointPayload = await call(baseUrl, session, "/preflight", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      plugins: artifacts.map(
        ({ id, version, previousVersion, manifest, storeJson, sha256 }) => ({
          id,
          version,
          previousVersion,
          manifest,
          storeJson,
          sha256,
        }),
      ),
    }),
  });
  const checkpoint = checkpointPayload?.checkpoint;
  if (!checkpoint || !Array.isArray(checkpoint.plugins))
    fail("deployment worker returned an invalid recovery checkpoint.");
  writeRecoveryFile(resolve(recoveryPath), checkpoint);

  const rows = new Map(
    checkpoint.plugins.map((plugin) => [plugin.id, plugin.tenants ?? []]),
  );
  try {
    for (const artifact of artifacts) {
      for (const target of rows.get(artifact.id) ?? []) {
        if (target.status !== "update") continue;
        const form = new FormData();
        form.set("tenant", target.tenant);
        form.set("id", artifact.id);
        form.set("version", artifact.version);
        form.set("previousVersion", artifact.previousVersion);
        form.set("sha256", artifact.sha256);
        form.set(
          "file",
          new File([readFileSync(artifact.path)], basename(artifact.path), {
            type: "application/zip",
          }),
        );
        await call(baseUrl, session, "/publish", {
          method: "POST",
          body: form,
        });
      }
    }
    await io.verify?.();
  } catch (publishError) {
    try {
      const rollbackResult = await call(baseUrl, session, "/rollback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ checkpoint }),
      });
      const skipped = rollbackResult?.skipped ?? [];
      const failures = rollbackResult?.failures ?? [];
      if (skipped.length || failures.length) {
        throw new Error(
          `Rollback left ${skipped.length} concurrent change(s) untouched and reported ${failures.length} failure(s): ${JSON.stringify({ skipped, failures })}`,
        );
      }
    } catch (rollbackError) {
      const detail = (error) =>
        error instanceof Error ? error.message : String(error);
      throw new AggregateError(
        [publishError, rollbackError],
        `Publication failed (${detail(publishError)}) and rollback was incomplete (${detail(rollbackError)}). Keep recovery file ${resolve(recoveryPath)} and inspect its tenant/plugin entries.`,
      );
    }
    throw publishError;
  }
  return {
    checkpoint: resolve(recoveryPath),
    updated: [...rows.values()]
      .flat()
      .filter((target) => target.status === "update").length,
    skipped: [...rows.values()]
      .flat()
      .filter((target) => target.status !== "update").length,
  };
}

async function availablePort() {
  return await new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close((error) =>
        error ? reject(error) : resolvePort(address.port),
      );
    });
  });
}

async function runPreviewSession(env, callback) {
  if (env.SAVIA_DEPLOY_ENVIRONMENT !== "preview")
    fail("SAVIA_DEPLOY_ENVIRONMENT must be preview.");
  const session = randomBytes(32).toString("hex");
  const config = deploymentConfig(env, session);
  config.name = "savia-preview-plugin-publisher-session";
  config.main = workerMain;
  config.workers_dev = false;
  config.preview_urls = false;
  const temporary = mkdtempSync(
    join(tmpdir(), "savia-preview-plugin-deployment-"),
  );
  const configPath = join(temporary, "wrangler.json");
  writeFileSync(configPath, JSON.stringify(config), { mode: 0o600 });
  const port = await availablePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(
    "pnpm",
    [
      "--dir",
      "apps/api",
      "exec",
      "wrangler",
      "dev",
      "--remote",
      "--config",
      configPath,
      "--ip",
      "127.0.0.1",
      "--port",
      String(port),
      "--inspector-port",
      "0",
      "--show-interactive-dev-session=false",
    ],
    { cwd: root, env, detached: true, stdio: "ignore" },
  );
  let exited = false;
  child.on("exit", () => (exited = true));
  child.on("error", () => (exited = true));
  try {
    let ready = false;
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline && !exited) {
      try {
        const payload = await workerCall(baseUrl, session, "/health");
        if (payload?.status === "ok") {
          ready = true;
          break;
        }
      } catch {
        /* The private Wrangler session is starting. */
      }
      await delay(1_000);
    }
    if (!ready || exited)
      fail("authenticated private preview session did not start.");
    return await callback(baseUrl, session);
  } finally {
    if (child.pid) {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        /* The session has already stopped. */
      }
    }
    rmSync(temporary, { recursive: true, force: true });
  }
}

export async function publishPreviewPlugins({
  planPath,
  recoveryPath,
  env = process.env,
  io = {},
}) {
  const plan = validatePluginPlan(JSON.parse(readFileSync(planPath, "utf8")));
  const { temporary, artifacts } = packagePlanPlugins(plan);
  const verify =
    io.verify ??
    (() =>
      execFileSync("node", ["scripts/verify-preview-health.mjs"], {
        cwd: root,
        stdio: "inherit",
      }));
  try {
    return await runPreviewSession(env, (baseUrl, session) =>
      publishPlan(plan, artifacts, recoveryPath, baseUrl, session, {
        verify,
      }),
    );
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    if (flag !== "--plan" && flag !== "--recovery")
      fail(`unknown argument ${flag}.`);
    const value = argv[++index];
    if (!value || value.startsWith("--")) fail(`missing value for ${flag}.`);
    values[flag] = value;
  }
  if (!values["--plan"] || !values["--recovery"])
    fail(
      "usage: node scripts/publish-preview-plugins.mjs --plan <file> --recovery <file>.",
    );
  return { planPath: values["--plan"], recoveryPath: values["--recovery"] };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const result = await publishPreviewPlugins(
      parseArgs(process.argv.slice(2)),
    );
    console.log(
      `Published preview plugin updates: ${result.updated}; already current: ${result.skipped}. Recovery: ${result.checkpoint}`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
