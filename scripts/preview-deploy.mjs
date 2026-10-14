import { createHmac } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import {
  dryRunDatabaseUuid,
  ephemeralSecret,
  flagValue,
  hasFlag,
  previewNames,
  slugifyBranch,
} from "./preview-environment.mjs";
import { ensureBranchInfrastructure } from "../infra/pulumi/branch-preview-resources.mjs";
import { workerConfig as buildWorkerConfig } from "../infra/pulumi/branch-preview-worker-config.mjs";

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

const execFileAsync = promisify(execFile);
const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const APPS = ["auth", "hookExecutor", "request", "mcp", "api", "gateway"];
const WORKER_APP = {
  auth: "auth",
  request: "savia-request",
  hookExecutor: "hook-executor",
  mcp: "mcp",
  api: "api",
  gateway: "admin",
};

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

const WORKER_SECRETS = {
  auth: ["BETTER_AUTH_SECRET", "SAVIA_INTERNAL_BRIDGE_KEY"],
  hookExecutor: [],
  request: ["ENCRYPTION_KEY"],
  mcp: ["SAVIA_MCP_SHARED_SECRET"],
  api: [
    "ASSISTANT_SETTINGS_ENCRYPTION_KEY",
    "STUDIO_INTEGRATION_KEY",
    "SAVIA_MCP_SHARED_SECRET",
    "SAVIA_INTERNAL_BRIDGE_KEY",
  ],
  gateway: [],
};

async function runWrangler(args, { cwd, input } = {}) {
  try {
    const { stdout } = await execFileWithInput(
      "pnpm",
      ["--filter", "@savia/api", "exec", "wrangler", ...args],
      { cwd: cwd ?? workspaceRoot, input },
    );
    return stdout;
  } catch (error) {
    error.previewCommand = `wrangler ${args.join(" ")}`;
    throw error;
  }
}

async function migrateDatabase(uuid) {
  await execFileAsync("node", ["scripts/apply-d1-migrations.mjs"], {
    cwd: workspaceRoot,
    env: { ...process.env, CLOUDFLARE_DATABASE_ID: uuid },
  });
}

async function runBranchCommand(executable, args, options = {}) {
  const { stdout, stderr } = await execFileAsync(executable, args, {
    cwd: options.cwd,
    env: options.env,
    maxBuffer: 32 * 1024 * 1024,
  });
  return { stdout, stderr };
}

async function putSecrets(kind, names, configPath, values) {
  for (const key of WORKER_SECRETS[kind]) {
    await runWrangler(["secret", "put", key, "--config", configPath], {
      cwd: join(workspaceRoot, "apps", WORKER_APP[kind]),
      input: values[key],
    });
  }
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

async function main() {
  const argv = process.argv.slice(2);
  const slug = slugifyBranch(flagValue(argv, "--branch"));
  const dryRun = hasFlag(argv, "--dry-run");
  const skipAdmin = hasFlag(argv, "--skip-admin");
  const enableSchedules = hasFlag(argv, "--enable-schedules");
  const names = previewNames(slug);
  if (!dryRun) {
    for (const variable of ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"]) {
      if (!process.env[variable]) throw new Error(`${variable} is required`);
    }
  }

  const kinds = skipAdmin ? APPS.filter((kind) => kind !== "gateway") : APPS;
  const configRoot = await mkdtemp(join(tmpdir(), `savia-preview-${slug}-`));
  const assetsDir = dryRun
    ? await mkdtemp(join(tmpdir(), "savia-preview-assets-"))
    : undefined;
  let ids;
  if (dryRun) {
    ids = { domain: dryRunDatabaseUuid(), auth: dryRunDatabaseUuid() };
  }
  if (!dryRun) {
    const infrastructure = await ensureBranchInfrastructure({
      slug,
      env: process.env,
      run: runBranchCommand,
    });
    ids = {
      domain: infrastructure.outputs.domainD1Id,
      auth: infrastructure.outputs.authD1Id,
    };
    await migrateDatabase(ids.domain);
  }

  const secrets = {
    BETTER_AUTH_SECRET: ephemeralSecret(),
    ENCRYPTION_KEY: ephemeralSecret(),
    ASSISTANT_SETTINGS_ENCRYPTION_KEY: ephemeralSecret(),
    STUDIO_INTEGRATION_KEY: ephemeralSecret(),
    SAVIA_MCP_SHARED_SECRET: ephemeralSecret(),
  };
  secrets.SAVIA_INTERNAL_BRIDGE_KEY = createHmac(
    "sha256",
    secrets.SAVIA_MCP_SHARED_SECRET,
  )
    .update("savia:auth-tenant-user-administration:v1")
    .digest("hex");
  const bootstrap = { password: ephemeralSecret() };

  const configs = {};
  let origin = "https://preview.local";
  const render = (kind, identityReady = true) =>
    workerConfig(kind, names, ids, origin, {
      assetsDir,
      bootstrap,
      identityReady,
      enableSchedules,
    });
  for (const kind of kinds) {
    const file = join(configRoot, `${kind}.wrangler.preview.jsonc`);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(
      file,
      `${JSON.stringify(render(kind, kind !== "auth"), null, 2)}\n`,
    );
    configs[kind] = file;
  }

  const results = [];
  const deploy = async (kind) => {
    const args = dryRun
      ? ["deploy", "--dry-run", "--config", configs[kind]]
      : ["deploy", "--config", configs[kind]];
    try {
      const output = await runWrangler(args, {
        cwd: join(workspaceRoot, "apps", WORKER_APP[kind]),
      });
      if (!dryRun) await putSecrets(kind, names, configs[kind], secrets);
      return { kind, ok: true, url: parseWorkersDevUrl(output) };
    } catch (error) {
      const detail = String(error.message ?? error.stderr ?? error).split("\n");
      const tail = String(error.stderr ?? "")
        .split("\n")
        .slice(-6);
      return {
        kind,
        ok: false,
        error: [...detail.slice(0, 2), ...tail].join("\n").slice(0, 600),
      };
    }
  };

  for (const kind of ["auth", "hookExecutor", "request", "mcp", "api"]) {
    if (kinds.includes(kind)) results.push(await deploy(kind));
  }
  const apiDeployment = results.find((result) => result.kind === "api");
  if (apiDeployment?.ok) {
    await writeFile(
      configs.auth,
      `${JSON.stringify(render("auth"), null, 2)}\n`,
    );
    results.push(await deploy("auth"));
  }
  if (kinds.includes("gateway")) {
    if (!dryRun) {
      await execFileAsync(
        "pnpm",
        ["--filter", "@savia/admin", "run", "build"],
        { cwd: workspaceRoot, maxBuffer: 16 * 1024 * 1024 },
      );
    }
    let gateway = await deploy("gateway");
    let gatewayUrl;
    try {
      gatewayUrl = requireGatewayOrigin(gateway, dryRun);
    } catch (error) {
      gateway = {
        ...gateway,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    results.push(gateway);
    if (gatewayUrl && !dryRun) {
      origin = gatewayUrl;
      for (const kind of ["auth", "api"]) {
        await writeFile(
          configs[kind],
          `${JSON.stringify(render(kind), null, 2)}\n`,
        );
        results.push(await deploy(kind));
      }
    }
  }

  console.log(`\nPreview ${dryRun ? "(dry run) " : ""}${names.suffix}`);
  for (const result of results) {
    console.log(
      `  ${result.ok ? "ok  " : "FAIL"} ${names.workers[result.kind]}${result.url ? ` ${result.url}` : ""}`,
    );
    if (!result.ok) console.log(`       ${result.error}`);
  }
  if (!dryRun) {
    console.log(
      `\nDestroy with: node scripts/preview-destroy.mjs --branch <name> --force`,
    );
    console.log(
      "Secrets are ephemeral per preview; live provider keys are not configured.",
    );
    console.log(
      `Bootstrap login: savia.admin@example.test / ${bootstrap.password}`,
    );
  }
  if (results.some((result) => !result.ok)) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
