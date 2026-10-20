import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { buildSecretUploads } from "./upload-cloudflare-secrets.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));

export function validateAuthDeployment(environment, config, env) {
  if (
    !["preview", "production"].includes(environment) ||
    env.SAVIA_DEPLOY_ENVIRONMENT !== environment
  )
    throw new Error("Auth deployment environment mismatch");
  if (
    environment === "production" &&
    (env.PRODUCTION_OPERATIONS_ENABLED !== "true" ||
      env.GITHUB_REF !== "refs/heads/main")
  )
    throw new Error("Production operations are disabled");
  const service =
    environment === "preview" ? "savia-auth-preview" : "savia-auth";
  const revision = config.vars?.SAVIA_AUTH_DEPLOYMENT_REVISION;
  const database = config.d1_databases?.find(
    (entry) => entry.binding === "AUTH_DB",
  );
  if (
    config.name !== service ||
    !/^[a-f\d]{40}$/.test(revision ?? "") ||
    !/^[a-f\d]{32}$/i.test(env.CLOUDFLARE_ACCOUNT_ID ?? "") ||
    (config.account_id && config.account_id !== env.CLOUDFLARE_ACCOUNT_ID) ||
    !env.SAVIA_AUTH_D1_ID ||
    database?.database_id !== env.SAVIA_AUTH_D1_ID ||
    !env.SAVIA_AUTH_D1_NAME ||
    database?.database_name !== env.SAVIA_AUTH_D1_NAME
  )
    throw new Error("Auth deployment target or revision mismatch");
  return { service, revision };
}

async function availablePort() {
  const server = createServer();
  await new Promise((accept, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", accept);
  });
  const port = server.address().port;
  await new Promise((accept, reject) =>
    server.close((error) => (error ? reject(error) : accept())),
  );
  return port;
}

export async function initializeAuthDeployment(
  { environment, configPath },
  { env = process.env, start = spawn, request = fetch } = {},
) {
  const config = JSON.parse(await readFile(configPath, "utf8"));
  const { service, revision } = validateAuthDeployment(
    environment,
    config,
    env,
  );
  const credential = buildSecretUploads(environment, env).find(
    (upload) => upload.app === "auth",
  )?.secrets.SAVIA_INTERNAL_BRIDGE_KEY;
  if (!credential) throw new Error("Auth deployment credential is missing");
  const nonce = randomBytes(32).toString("hex");
  const directory = await mkdtemp(join(tmpdir(), "savia-auth-deployment-"));
  let child,
    exited = false;
  try {
    const path = join(directory, "wrangler.json");
    await writeFile(
      path,
      JSON.stringify({
        name: `savia-auth-${environment}-initialization-session`,
        main: join(root, "scripts/auth-deployment/worker.mjs"),
        compatibility_date: "2026-09-01",
        account_id: env.CLOUDFLARE_ACCOUNT_ID,
        workers_dev: false,
        preview_urls: false,
        services: [{ binding: "AUTH", service }],
        vars: { AUTH_REVISION: revision, PROBE_NONCE: nonce },
      }),
      { mode: 0o600 },
    );
    const port = await availablePort();
    child = start(
      join(root, "apps/api/node_modules/.bin/wrangler"),
      [
        "dev",
        "--remote",
        "--config",
        path,
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
    child.on("exit", () => {
      exited = true;
    });
    child.on("error", () => {
      exited = true;
    });
    const base = `http://127.0.0.1:${port}`;
    const deadline = Date.now() + 90_000;
    let ready = false;
    while (Date.now() < deadline && !exited) {
      try {
        const response = await request(`${base}/ready`, {
          signal: AbortSignal.timeout(5_000),
          redirect: "error",
        });
        if (response.ok && (await response.json()).nonce === nonce) {
          ready = true;
          break;
        }
      } catch {
        /* The authenticated remote session is still starting. */
      }
      await delay(1_000);
    }
    if (!ready || exited)
      throw new Error("Auth initialization session unavailable");
    const response = await request(`${base}/initialize`, {
      method: "POST",
      headers: {
        "x-savia-bridge-key": credential,
        "x-savia-probe-nonce": nonce,
      },
      signal: AbortSignal.timeout(120_000),
      redirect: "error",
    });
    if (!response.ok) throw new Error("Auth preparation failed");
    const result = await response.json();
    if (result.status !== "ready" || result.revision !== revision)
      throw new Error("Auth deployment readiness mismatch");
    return { status: "ready", revision };
  } finally {
    if (child?.pid) {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        /* Already stopped. */
      }
      const deadline = Date.now() + 5_000;
      while (!exited && Date.now() < deadline) await delay(100);
      if (!exited) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          /* Already stopped. */
        }
      }
    }
    await rm(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  Promise.resolve()
    .then(() => {
      if (
        args.length !== 4 ||
        args[0] !== "--environment" ||
        args[2] !== "--config"
      )
        throw new Error(
          "Use --environment <preview|production> --config <frozen Auth config>",
        );
      return initializeAuthDeployment({
        environment: args[1],
        configPath: resolve(args[3]),
      });
    })
    .then((result) =>
      console.log(`Auth prepared for source revision ${result.revision}.`),
    )
    .catch(() => {
      console.error(
        "Auth deployment preparation failed; application publication is blocked.",
      );
      process.exitCode = 1;
    });
}
