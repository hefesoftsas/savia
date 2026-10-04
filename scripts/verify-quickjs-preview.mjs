import { spawn } from "node:child_process";
import { once } from "node:events";
import { appendFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

import {
  flagValue,
  previewNames,
  slugifyBranch,
} from "./preview-environment.mjs";

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const port = 18878;
const startupTimeoutMs = 90_000;
const healthTimeoutMs = 5_000;
const cpuTimeoutMs = 75_000;

export function previewSmokeConfig(slug) {
  const names = previewNames(slug);
  return {
    name: `savia-quickjs-smoke-${slug}`,
    main: fileURLToPath(
      new URL("./quickjs-preview-smoke/worker.mjs", import.meta.url),
    ),
    compatibility_date: "2026-09-04",
    workers_dev: false,
    preview_urls: false,
    limits: { cpu_ms: 60_000 },
    services: [
      {
        binding: "HOOK_SERVICE",
        service: names.workers.hookExecutor,
      },
    ],
    observability: { enabled: false },
  };
}

async function requestRoute(path, timeoutMs) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: "GET",
    redirect: "error",
    signal: AbortSignal.timeout(timeoutMs),
  });
  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error("invalid-response");
  }
  return { status: response.status, body };
}

function startRemoteSession(configPath) {
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
    { cwd: workspaceRoot, detached: true, stdio: "ignore" },
  );
  let exited = false;
  child.on("exit", () => {
    exited = true;
  });
  child.on("error", () => {
    exited = true;
  });
  return { child, hasExited: () => exited };
}

async function waitForHealth(session) {
  const deadline = Date.now() + startupTimeoutMs;
  while (Date.now() < deadline && !session.hasExited()) {
    try {
      const result = await requestRoute("/health", healthTimeoutMs);
      if (result.status === 200 && result.body?.outcome === "health-passed")
        return;
    } catch {
      // Wrangler remote dev may need time to create its authenticated session.
    }
    await delay(1_500);
  }
  throw new Error("startup-failed");
}

async function stopRemoteSession(session) {
  if (!session?.child.pid || session.hasExited()) return;
  try {
    process.kill(-session.child.pid, "SIGTERM");
  } catch {
    // The process group may already be gone.
  }
  await Promise.race([
    once(session.child, "exit").catch(() => undefined),
    delay(5_000),
  ]);
  if (!session.hasExited()) {
    try {
      process.kill(-session.child.pid, "SIGKILL");
    } catch {
      // The process group may already be gone.
    }
    await Promise.race([
      once(session.child, "exit").catch(() => undefined),
      delay(1_000),
    ]);
  }
}

async function recordSummary(slug, outcomes) {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) return;
  const rows = outcomes.length
    ? outcomes
        .map(
          ({ test, status, elapsedMs }) =>
            `| ${test} | ${status} | ${elapsedMs ?? "—"} |`,
        )
        .join("\n")
    : "| startup | FAIL | — |";
  await appendFile(
    summaryPath,
    `\n### QuickJS preview smoke (${slug})\n\n| Check | Result | Elapsed ms |\n| --- | --- | ---: |\n${rows}\n`,
  );
}

async function main() {
  const slug = slugifyBranch(flagValue(process.argv.slice(2), "--branch"));
  const configDirectory = await mkdtemp(
    `${tmpdir()}/savia-quickjs-preview-${slug}-`,
  );
  const configPath = `${configDirectory}/wrangler.jsonc`;
  await writeFile(
    configPath,
    `${JSON.stringify(previewSmokeConfig(slug), null, 2)}\n`,
  );
  const outcomes = [];
  let session;
  let failure;
  let activeTest = "startup";
  try {
    session = startRemoteSession(configPath);
    await waitForHealth(session);
    outcomes.push({
      test: "health-and-transformation",
      status: "PASS",
      elapsedMs: 0,
    });

    activeTest = "isolation";
    const isolation = await requestRoute("/isolation", healthTimeoutMs);
    if (
      isolation.status !== 200 ||
      isolation.body?.outcome !== "isolation-passed"
    ) {
      outcomes.push({ test: "isolation", status: "FAIL", elapsedMs: null });
      throw new Error("isolation-failed");
    }
    outcomes.push({ test: "isolation", status: "PASS", elapsedMs: 0 });

    activeTest = "cpu-limit-and-recovery";
    const cpu = await requestRoute("/cpu", cpuTimeoutMs);
    const cpuPassed =
      cpu.status === 200 &&
      cpu.body?.outcome === "platform-terminated" &&
      cpu.body?.recovered === true &&
      Number.isInteger(cpu.body?.elapsedMs);
    outcomes.push({
      test: "cpu-limit-and-recovery",
      status: cpuPassed ? "PASS" : "FAIL",
      elapsedMs: Number.isInteger(cpu.body?.elapsedMs)
        ? cpu.body.elapsedMs
        : null,
    });
    if (!cpuPassed) throw new Error("cpu-limit-not-established");
    activeTest = "";
  } catch (error) {
    failure = error instanceof Error ? error.message : "smoke-failed";
    if (
      activeTest &&
      !outcomes.some((outcome) => outcome.test === activeTest)
    ) {
      outcomes.push({ test: activeTest, status: "FAIL", elapsedMs: null });
    }
  } finally {
    await stopRemoteSession(session);
    await rm(configDirectory, { recursive: true, force: true });
    await recordSummary(slug, outcomes);
  }

  if (failure) throw new Error(`QuickJS preview smoke failed: ${failure}`);
  process.stdout.write(`QuickJS preview smoke passed for ${slug}.\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : "QuickJS preview smoke failed"}\n`,
    );
    process.exitCode = 1;
  });
}
