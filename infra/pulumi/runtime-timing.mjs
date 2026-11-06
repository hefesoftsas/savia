import {
  appendFile,
  chmod,
  mkdir,
  readdir,
  readFile,
  stat,
} from "node:fs/promises";
import { isAbsolute, join, parse, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PHASES = [
  "quiesce",
  "backup",
  "migrate",
  "secrets",
  "deploy",
  "verify",
  "resume",
];
const WORKER_ROLES = [
  "api",
  "auth",
  "flows",
  "mcp",
  "request",
  "gateway",
  "legacy",
  "connectors",
  "hook-executor",
  "plugin-editor",
  "backup-coordinator",
];
const COMMAND_LABELS = [
  "auth-init",
  "migrations",
  "flows-migrations",
  "backup:flows",
  "backup:production",
  "backup:production-r2",
  "backup:runtime",
  "backup:archive",
  "runtime-command",
  "wrangler-command",
  "gateway-verify",
];
const ALLOWED_LABELS = new Set([
  ...PHASES.map((phase) => `phase:${phase}`),
  ...WORKER_ROLES.map((role) => `worker-deploy:${role}`),
  ...COMMAND_LABELS,
]);
const OPERATION_FILE = /^timings-(\d+)\.jsonl$/;
let writeQueue = Promise.resolve();

function validRow(row) {
  return (
    row !== null &&
    typeof row === "object" &&
    !Array.isArray(row) &&
    Object.keys(row).length === 3 &&
    typeof row.label === "string" &&
    ALLOWED_LABELS.has(row.label) &&
    Number.isSafeInteger(row.durationMs) &&
    row.durationMs >= 0 &&
    row.durationMs <= 1_000_000_000 &&
    (row.outcome === "success" || row.outcome === "failure")
  );
}

export function isAllowedRuntimeTimingLabel(label) {
  return typeof label === "string" && ALLOWED_LABELS.has(label);
}

export async function recordRuntimeTiming(
  directory,
  label,
  durationMs,
  outcome,
) {
  const row = {
    label,
    durationMs:
      typeof durationMs === "number" && Number.isFinite(durationMs)
        ? Math.round(durationMs)
        : durationMs,
    outcome,
  };
  if (!validRow(row)) {
    if (typeof label !== "string" || !ALLOWED_LABELS.has(label))
      throw new TypeError("Invalid runtime timing label");
    if (
      !Number.isSafeInteger(durationMs) ||
      durationMs < 0 ||
      durationMs > 1_000_000_000
    )
      throw new TypeError("Invalid runtime timing duration");
    throw new TypeError("Invalid runtime timing outcome");
  }
  if (typeof directory !== "string" || !isAbsolute(directory)) return false;
  const operationDirectory = resolve(directory);
  if (operationDirectory === parse(operationDirectory).root) return false;
  const path = join(operationDirectory, `timings-${process.pid}.jsonl`);
  const task = writeQueue.then(async () => {
    await mkdir(operationDirectory, { recursive: true, mode: 0o700 });
    await chmod(operationDirectory, 0o700);
    await appendFile(path, `${JSON.stringify(row)}\n`, { mode: 0o600 });
    await chmod(path, 0o600);
    return true;
  });
  writeQueue = task.catch(() => {});
  try {
    return await task;
  } catch {
    return false;
  }
}

export async function readRuntimeTimings(directory) {
  if (typeof directory !== "string" || !isAbsolute(directory)) return [];
  const root = resolve(directory);
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const rows = [];
  for (const entry of entries) {
    if (!entry.isFile() || !OPERATION_FILE.test(entry.name)) continue;
    try {
      const path = join(root, entry.name);
      const metadata = await stat(path);
      if (!metadata.isFile() || metadata.size > 1024 * 1024) continue;
      const contents = await readFile(path, "utf8");
      for (const line of contents.split("\n")) {
        if (!line || line.length > 4096) continue;
        try {
          const row = JSON.parse(line);
          if (validRow(row)) rows.push(row);
        } catch {
          // Ignore partial or malformed lines; never echo source data.
        }
      }
    } catch {
      // A concurrently-created or unreadable file is omitted.
    }
  }
  return rows;
}

export function formatRuntimeTimingSummary(rows) {
  const safeRows = Array.isArray(rows) ? rows.filter(validRow) : [];
  const lines = [
    "### Runtime operation timings",
    "",
    "| Operation | Duration | Outcome |",
    "| --- | ---: | --- |",
  ];
  if (!safeRows.length) lines.push("| No timing records | — | unavailable |");
  for (const row of safeRows)
    lines.push(`| ${row.label} | ${row.durationMs} ms | ${row.outcome} |`);
  return `${lines.join("\n")}\n`;
}

async function main() {
  if (process.argv[2] !== "summary")
    throw new Error("Usage: runtime-timing.mjs summary");
  const directory = process.env.SAVIA_RUNTIME_OPERATION_DIRECTORY;
  const summary = formatRuntimeTimingSummary(
    await readRuntimeTimings(directory),
  );
  process.stdout.write(summary);
  const destination = process.env.GITHUB_STEP_SUMMARY;
  if (typeof destination === "string" && isAbsolute(destination))
    await appendFile(destination, `\n${summary}`, { mode: 0o600 }).catch(
      () => {},
    );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
)
  main().catch(() => {
    process.stderr.write("Unable to publish runtime timing summary\n");
    process.exitCode = 1;
  });
