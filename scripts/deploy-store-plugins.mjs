import { execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { packageStorePlugin } from "./pack-store-plugin.mjs";

const root = resolve(import.meta.dirname, "..");

export function releaseArtifacts(directory = join(root, "deployment/plugins")) {
  mkdirSync(directory, { recursive: true });
  const sourcePath = join(directory, "sources.json");
  if (existsSync(sourcePath)) {
    const sources = JSON.parse(readFileSync(sourcePath, "utf8"));
    if (
      !Array.isArray(sources.ports) ||
      sources.ports.some(
        (port) => typeof port !== "string" || !/^[a-z0-9-]+$/.test(port),
      )
    )
      throw new Error(
        "Plugin sources.json requires a ports array of directory names.",
      );
    for (const port of sources.ports)
      packageStorePlugin({
        portDir: `store-ports/${port}`,
        outputPath: join(directory, `${port}.store.zip`),
      });
  }
  const artifacts = readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".zip"))
    .map((entry) => {
      const path = join(directory, entry.name);
      const manifest = JSON.parse(
        execFileSync("unzip", ["-p", path, "savia-extension.json"], {
          encoding: "utf8",
          maxBuffer: 1024 * 1024,
        }),
      );
      if (typeof manifest.id !== "string" || !Array.isArray(manifest.requires))
        throw new Error(`Invalid plugin manifest in ${entry.name}.`);
      return { path, manifest };
    });
  const byId = new Map();
  for (const artifact of artifacts) {
    if (byId.has(artifact.manifest.id))
      throw new Error(
        `Multiple deployment ZIPs for ${artifact.manifest.id}. Keep one version per release.`,
      );
    byId.set(artifact.manifest.id, artifact);
  }
  const ordered = [],
    visiting = new Set(),
    visited = new Set();
  function visit(id) {
    if (visited.has(id) || !byId.has(id)) return;
    if (visiting.has(id)) throw new Error(`Circular plugin dependency: ${id}.`);
    visiting.add(id);
    const artifact = byId.get(id);
    for (const dependency of artifact.manifest.requires) visit(dependency);
    visiting.delete(id);
    visited.add(id);
    ordered.push(artifact);
  }
  for (const id of [...byId.keys()].sort()) visit(id);
  return ordered;
}

export function deploymentConfig(env, session) {
  for (const name of [
    "CLOUDFLARE_ACCOUNT_ID",
    "CLOUDFLARE_API_TOKEN",
    "CLOUDFLARE_DATABASE_ID",
  ])
    if (!env[name]?.trim())
      throw new Error(`${name} is required for plugin deployment.`);
  if (!["preview", "production"].includes(env.SAVIA_DEPLOY_ENVIRONMENT))
    throw new Error("SAVIA_DEPLOY_ENVIRONMENT must be preview or production.");
  return {
    name: `savia-${env.SAVIA_DEPLOY_ENVIRONMENT}-plugin-deployment-session`,
    main: join(root, "scripts/plugin-deployment/worker.ts"),
    compatibility_date: "2026-09-01",
    compatibility_flags: ["nodejs_compat"],
    workers_dev: false,
    preview_urls: false,
    vars: { DEPLOYMENT_SESSION: session },
    d1_databases: [
      {
        binding: "DB",
        database_name: `savia-${env.SAVIA_DEPLOY_ENVIRONMENT}-deployment`,
        database_id: env.CLOUDFLARE_DATABASE_ID,
        preview_database_id: env.CLOUDFLARE_DATABASE_ID,
      },
    ],
  };
}

export async function deployArtifacts(artifacts, baseUrl, session, io = {}) {
  const request = io.fetch ?? fetch,
    log = io.log ?? console.log;
  async function call(path, init = {}) {
    const response = await request(`${baseUrl}${path}`, {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(120_000),
      headers: { ...init.headers, authorization: `Bearer ${session}` },
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok)
      throw new Error(
        `Plugin deployment ${path} failed (HTTP ${response.status}): ${JSON.stringify(payload?.error ?? "unavailable")}`,
      );
    return payload;
  }
  const { tenants } = await call("/tenants");
  if (!Array.isArray(tenants))
    throw new Error("Deployment worker returned an invalid tenant list.");
  for (const tenant of tenants) {
    // Upload every dependency before installing in topological order.
    for (const artifact of artifacts) {
      const form = new FormData();
      form.set(
        "file",
        new File([readFileSync(artifact.path)], basename(artifact.path), {
          type: "application/zip",
        }),
      );
      await call(`/upload?tenant=${encodeURIComponent(tenant)}`, {
        method: "POST",
        body: form,
      });
    }
    for (const artifact of artifacts) {
      const installed = await call(
        `/install?tenant=${encodeURIComponent(tenant)}&id=${encodeURIComponent(artifact.manifest.id)}`,
        { method: "POST" },
      );
      log(
        `Activated ${artifact.manifest.id}@${installed?.data?.version ?? artifact.manifest.version} in ${tenant}`,
      );
    }
  }
  log(
    `Deployed ${artifacts.length} release plugins to ${tenants.length} workspaces.`,
  );
  return { plugins: artifacts.length, tenants: tenants.length };
}

export async function deployStorePlugins(env = process.env) {
  const artifacts = releaseArtifacts(env.SAVIA_PLUGIN_DIRECTORY);
  if (!artifacts.length) {
    console.log("No deployment plugin ZIPs found.");
    return;
  }
  const session = randomBytes(32).toString("hex");
  const config = deploymentConfig(env, session);
  const temporary = mkdtempSync(join(tmpdir(), "savia-plugin-deployment-"));
  const configPath = join(temporary, "wrangler.json");
  writeFileSync(configPath, JSON.stringify(config), { mode: 0o600 });
  const port = 18877;
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
  child.on("exit", () => {
    exited = true;
  });
  child.on("error", () => {
    exited = true;
  });
  try {
    let ready = false;
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline && !exited) {
      try {
        const response = await fetch(`${baseUrl}/health`, {
          headers: { authorization: `Bearer ${session}` },
          signal: AbortSignal.timeout(5_000),
          redirect: "error",
        });
        if (response.ok && (await response.json()).status === "ok") {
          ready = true;
          break;
        }
      } catch {
        /* Wrangler remote session is starting. */
      }
      await delay(2_000);
    }
    if (!ready || exited)
      throw new Error("Authenticated plugin deployment session did not start.");
    return await deployArtifacts(artifacts, baseUrl, session);
  } finally {
    if (child.pid) {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        /* Already stopped. */
      }
    }
    rmSync(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await deployStorePlugins();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
