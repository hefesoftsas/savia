import { randomBytes } from "node:crypto";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_PUBLIC_ORIGIN,
  PREVIEW_PUBLIC_ORIGIN,
  normalizeEnvironment,
} from "../infra/pulumi/naming.mjs";

const API_PATH = "/api/public/savia-flows/maintenance";
const HEALTH_PATH = "/__session/health";
const START_TIMEOUT_MS = 90_000;
const POLL_INTERVAL_MS = 500;
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG_MAIN = resolve(REPO_ROOT, "scripts/flows-maintenance/worker.mjs");

async function reserveLocalPort() {
  const server = createServer();
  await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Could not reserve a local maintenance port");
  }
  await new Promise((resolvePromise, reject) =>
    server.close((error) => (error ? reject(error) : resolvePromise())),
  );
  return address.port;
}

function validateTransportCredentials(env) {
  let environment;
  try {
    environment = normalizeEnvironment(env.SAVIA_DEPLOY_ENVIRONMENT);
  } catch {
    throw new Error("Flows maintenance transport environment is invalid");
  }
  if (!/^[a-f\d]{32}$/i.test(env.CLOUDFLARE_ACCOUNT_ID ?? "")) {
    throw new Error(`A valid ${environment} CLOUDFLARE_ACCOUNT_ID is required`);
  }
  if (
    typeof env.CLOUDFLARE_API_TOKEN !== "string" ||
    !env.CLOUDFLARE_API_TOKEN
  ) {
    throw new Error(
      `CLOUDFLARE_API_TOKEN is required for ${environment} maintenance`,
    );
  }
  return environment;
}

function createSessionConfig(token, environment) {
  return {
    name: "savia-flows-maintenance-session",
    main: CONFIG_MAIN,
    compatibility_date: "2026-09-01",
    workers_dev: false,
    preview_urls: false,
    vars: { SESSION_TOKEN: token },
    services: [
      {
        binding: "SAVIA_HOST",
        service:
          environment === "preview"
            ? "savia-agencies-preview"
            : "savia-agencies",
      },
    ],
  };
}

function waitForExit(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }
  return new Promise((resolvePromise) => {
    child.once("exit", resolvePromise);
    child.once("error", resolvePromise);
    child.once("close", resolvePromise);
  });
}

async function stopChild(child) {
  if (!child.pid) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    try {
      child.kill("SIGTERM");
    } catch {
      return;
    }
  }
  const exited = waitForExit(child);
  const graceful = await new Promise((resolvePromise) => {
    const timeout = setTimeout(() => resolvePromise(false), 5000);
    exited.then(() => {
      clearTimeout(timeout);
      resolvePromise(true);
    });
  });
  if (!graceful) {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      try {
        child.kill("SIGKILL");
      } catch {
        // The process group may have exited between the timeout and signal.
      }
    }
    await exited;
  }
}

/** Start a private, ephemeral Wrangler session for the selected maintenance API. */
export async function startFlowsMaintenanceTransport({
  env = process.env,
  fetchImpl = fetch,
  spawnImpl = spawn,
  createTempDir = (prefix) => mkdtemp(prefix),
  removeTempDir = (path) => rm(path, { recursive: true, force: true }),
  writeConfig = writeFile,
  reservePort = reserveLocalPort,
  sleepImpl = (milliseconds) =>
    new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds)),
  now = () => Date.now(),
} = {}) {
  const environment = validateTransportCredentials(env);
  const publicOrigin =
    environment === "preview" ? PREVIEW_PUBLIC_ORIGIN : DEFAULT_PUBLIC_ORIGIN;
  const token = randomBytes(32).toString("base64url");
  const port = await reservePort();
  const sessionDir = await createTempDir(
    `${tmpdir()}/savia-flows-maintenance-`,
  );
  await chmod(sessionDir, 0o700);
  const configPath = `${sessionDir}/wrangler.json`;
  let child;
  let closed = false;
  try {
    await writeConfig(
      configPath,
      JSON.stringify(createSessionConfig(token, environment)),
      {
        encoding: "utf8",
        mode: 0o600,
        flag: "wx",
      },
    );
    await chmod(configPath, 0o600);
    child = spawnImpl(
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
      { cwd: REPO_ROOT, detached: true, stdio: "ignore", env },
    );
    let exited = false;
    child.once("exit", () => {
      exited = true;
    });
    child.once("error", () => {
      exited = true;
    });

    const deadline = now() + START_TIMEOUT_MS;
    let ready = false;
    while (now() < deadline && !exited) {
      try {
        const response = await fetchImpl(
          `http://127.0.0.1:${port}${HEALTH_PATH}`,
          {
            headers: { authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(2_000),
            redirect: "error",
          },
        );
        if (response.ok) {
          const payload = await response.json();
          if (payload?.ready === true) {
            ready = true;
            break;
          }
        }
      } catch {
        // Wrangler remote session may still be starting.
      }
      await sleepImpl(POLL_INTERVAL_MS);
    }
    if (!ready || exited) {
      throw new Error("Private preview maintenance session failed to start");
    }

    return {
      async fetchImpl(url, init = {}) {
        const target = new URL(url);
        if (
          target.origin !== publicOrigin ||
          target.pathname !== API_PATH ||
          target.search !== "" ||
          target.hash !== ""
        ) {
          throw new Error("Private maintenance transport rejected destination");
        }
        const headers = new Headers(init.headers);
        headers.set("authorization", `Bearer ${token}`);
        return fetchImpl(`http://127.0.0.1:${port}${API_PATH}`, {
          ...init,
          headers,
          redirect: "error",
        });
      },
      async close() {
        if (closed) return;
        closed = true;
        try {
          await stopChild(child);
        } finally {
          await removeTempDir(sessionDir);
        }
      },
    };
  } catch (error) {
    try {
      if (child) await stopChild(child);
    } finally {
      await removeTempDir(sessionDir);
    }
    throw error;
  }
}

export async function startPreviewMaintenanceTransport(options = {}) {
  const env = options.env ?? process.env;
  if (env.SAVIA_DEPLOY_ENVIRONMENT !== "preview") {
    throw new Error("Private Flows maintenance transport is preview-only");
  }
  return startFlowsMaintenanceTransport(options);
}
