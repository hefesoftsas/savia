import { createHmac, randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const API = "https://api.cloudflare.com/client/v4";
const SERVICE = "savia-auth-preview";
const SENTINEL = "0".repeat(40);
const UUID =
  /^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;
const CATEGORIES = new Set([
  "AUTH_BRIDGE_REJECTED",
  "REVISION_MISMATCH",
  "INITIALIZATION_FAILED",
  "UPSTREAM_REJECTED",
  "TRANSPORT_FAILED",
  "READINESS_MISMATCH",
]);

export function validateActiveRevisionMetadata(deployments, metadata) {
  const entries = Array.isArray(deployments)
    ? deployments
    : deployments?.deployments;
  const versions = entries?.[0]?.versions;
  if (
    !Array.isArray(versions) ||
    versions.length === 0 ||
    versions.length !== metadata.length
  )
    throw new Error("Active Auth deployment metadata is unavailable");
  const parsed = versions.map((entry) => ({
    id: entry?.version_id,
    percentage: entry?.percentage,
  }));
  if (
    parsed.some(
      ({ id, percentage }) =>
        !UUID.test(id ?? "") ||
        typeof percentage !== "number" ||
        percentage <= 0 ||
        percentage > 100,
    ) ||
    Math.abs(parsed.reduce((sum, entry) => sum + entry.percentage, 0) - 100) >
      1e-9
  )
    throw new Error("Active Auth deployment metadata is invalid");
  const revisions = metadata.map(
    (version) =>
      version?.resources?.bindings?.find(
        (binding) =>
          binding?.type === "plain_text" &&
          binding.name === "SAVIA_AUTH_DEPLOYMENT_REVISION",
      )?.text,
  );
  if (
    revisions.some(
      (revision) =>
        !/^[a-f\d]{40}$/i.test(revision ?? "") ||
        revision.toLowerCase() === SENTINEL,
    )
  )
    throw new Error(
      "Active Auth revision is invalid or matches the diagnostic sentinel",
    );
  return revisions;
}

async function availablePort() {
  const server = createServer();
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const port = server.address().port;
  await new Promise((resolveClose, reject) =>
    server.close((error) => (error ? reject(error) : resolveClose())),
  );
  return port;
}

async function cloudflareGet(accountId, token, path, fetcher) {
  let response;
  try {
    response = await fetcher(`${API}/accounts/${accountId}${path}`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(20_000),
    });
    const payload = await response.json();
    if (!response.ok || payload?.success !== true) throw new Error();
    return payload.result;
  } catch {
    throw new Error(
      `Cloudflare read failed (${response?.status ?? "transport"})`,
    );
  }
}

export async function checkAuthBridge({
  env = process.env,
  fetcher = fetch,
  start = spawn,
  report = console.log,
} = {}) {
  const {
    CLOUDFLARE_ACCOUNT_ID: configuredAccountId,
    CLOUDFLARE_API_TOKEN: configuredToken,
    SAVIA_MCP_SHARED_SECRET: secret,
    AUTH_PROBE_WRANGLER_BIN: wrangler,
  } = env;
  const accountId = configuredAccountId ?? env.CF_ACCOUNT_ID;
  const token = configuredToken ?? env.CF_TOKEN;
  if (
    !/^[a-f\d]{32}$/i.test(accountId ?? "") ||
    !token ||
    !secret?.trim() ||
    !isAbsolute(wrangler ?? "")
  )
    throw new Error(
      "Auth bridge check credentials or Wrangler path are missing",
    );
  const deployments = await cloudflareGet(
    accountId,
    token,
    `/workers/scripts/${SERVICE}/deployments`,
    fetcher,
  );
  const versions = deployments?.deployments?.[0]?.versions;
  if (!Array.isArray(versions) || versions.length === 0)
    throw new Error("Active Auth deployment metadata is unavailable");
  const metadata = await Promise.all(
    versions.map(({ version_id }) => {
      if (!UUID.test(version_id ?? ""))
        throw new Error("Active Auth deployment metadata is invalid");
      return cloudflareGet(
        accountId,
        token,
        `/workers/scripts/${SERVICE}/versions/${version_id}`,
        fetcher,
      );
    }),
  );
  validateActiveRevisionMetadata(deployments, metadata);

  const nonce = randomBytes(32).toString("hex");
  const bridgeKey = createHmac("sha256", secret.trim())
    .update("savia:auth-tenant-user-administration:v1")
    .digest("hex");
  const directory = await mkdtemp(join(tmpdir(), "savia-auth-bridge-check-"));
  let child;
  let exited = false;
  let stdout = "";
  let stderr = "";
  try {
    const configPath = join(directory, "wrangler.json");
    await writeFile(
      configPath,
      JSON.stringify({
        name: "savia-auth-preview-bridge-check",
        main: fileURLToPath(
          new URL("./auth-deployment/worker.mjs", import.meta.url),
        ),
        compatibility_date: "2026-09-01",
        account_id: accountId,
        workers_dev: false,
        preview_urls: false,
        services: [{ binding: "AUTH", service: SERVICE }],
        vars: { AUTH_REVISION: SENTINEL, PROBE_NONCE: nonce },
      }),
      { mode: 0o600 },
    );
    const port = await availablePort();
    const childEnv = { ...env };
    delete childEnv.SAVIA_MCP_SHARED_SECRET;
    child = start(
      wrangler,
      [
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
      {
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: childEnv,
      },
    );
    child.stdout?.on("data", (chunk) => {
      stdout = (stdout + chunk.toString()).slice(-65_536);
    });
    child.stderr?.on("data", (chunk) => {
      stderr = (stderr + chunk.toString()).slice(-65_536);
    });
    child.on("exit", () => {
      exited = true;
    });
    child.on("error", () => {
      exited = true;
    });
    const base = `http://127.0.0.1:${port}`;
    const deadline = Date.now() + 60_000;
    let ready = false;
    while (Date.now() < deadline && !exited) {
      try {
        const response = await fetcher(`${base}/ready`, {
          signal: AbortSignal.timeout(2_000),
          redirect: "error",
        });
        if (response.ok && (await response.json()).nonce === nonce) {
          ready = true;
          break;
        }
      } catch {
        /* Session startup remains bounded by the deadline. */
      }
      await delay(1_000);
    }
    if (!ready || exited) throw new Error("Auth bridge session unavailable");
    let response;
    try {
      response = await fetcher(`${base}/initialize`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-savia-bridge-key": bridgeKey,
          "x-savia-probe-nonce": nonce,
        },
        signal: AbortSignal.timeout(20_000),
        redirect: "error",
      });
    } catch {
      report("TRANSPORT_FAILED");
      throw new Error("Auth bridge check failed");
    }
    let body;
    try {
      body = await response.json();
    } catch {
      body = undefined;
    }
    const category = CATEGORIES.has(body?.error)
      ? body.error
      : "UPSTREAM_REJECTED";
    const status =
      Number.isInteger(body?.upstreamStatus) &&
      body.upstreamStatus >= 100 &&
      body.upstreamStatus <= 599
        ? body.upstreamStatus
        : undefined;
    if (
      response.status === 502 &&
      category === "REVISION_MISMATCH" &&
      status === 409
    ) {
      report("REVISION_MISMATCH upstream HTTP 409");
      return { category, upstreamStatus: status };
    }
    if (
      response.status === 403 ||
      (category === "AUTH_BRIDGE_REJECTED" && status === 403)
    ) {
      report("AUTH_BRIDGE_REJECTED HTTP 403");
      throw new Error("Auth bridge check failed");
    }
    report(`${category}${status ? ` upstream HTTP ${status}` : ""}`);
    throw new Error("Auth bridge check failed");
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
    stdout = "";
    stderr = "";
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  checkAuthBridge().catch(() => {
    console.error("Auth bridge check failed; private details withheld.");
    process.exitCode = 1;
  });
}
