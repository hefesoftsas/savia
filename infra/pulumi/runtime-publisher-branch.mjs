import { spawn } from "node:child_process";
import { workerConfig as buildWorkerConfig } from "./branch-preview-worker-config.mjs";

export function workerConfig(
  kind,
  names,
  ids,
  origin,
  { enableSchedules = false, ...options } = {},
) {
  const config = buildWorkerConfig(kind, names, ids, origin, options);
  if (kind === "api") {
    config.compatibility_flags = [
      ...(config.compatibility_flags ?? []),
      "global_fetch_strictly_public",
    ];
    if (enableSchedules) config.triggers = { crons: ["* * * * *"] };
  }
  return config;
}

export function workerDeploymentOrder(kinds) {
  return [
    "auth",
    "hookExecutor",
    "request",
    "connectorGateway",
    "mcp",
    "api",
    "gateway",
  ].filter((kind) => kinds.includes(kind));
}

export function execFileWithInput(
  executable,
  args,
  { cwd, env, input } = {},
  spawnImpl = spawn,
) {
  return new Promise((resolve, reject) => {
    const child = spawnImpl(executable, args, {
      cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
    child.stdin.on("error", (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      const error = new Error(
        `${executable} exited with ${code === null ? signal : `code ${code}`}`,
      );
      Object.assign(error, { code, signal, stdout, stderr });
      reject(error);
    });
    child.stdin.end(input);
  });
}

export function parseWorkersDevUrl(output) {
  return (
    String(output).match(
      /https:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)?\.workers\.dev/,
    )?.[0] ?? null
  );
}

export function requireGatewayOrigin(gateway, dryRun) {
  if (gateway?.url) return gateway.url;
  if (dryRun) return null;
  throw new Error(
    "Could not determine preview origin from deployed gateway URL.",
  );
}

export async function publishBranchPreview(argv = process.argv.slice(2)) {
  const { runBranchDeployment } = await import("./environment-branch.mjs");
  return runBranchDeployment(argv);
}
