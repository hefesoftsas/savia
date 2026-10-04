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
  findDatabaseUuid,
  flagValue,
  hasFlag,
  previewNames,
  slugifyBranch,
} from "./preview-environment.mjs";

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

export function workerConfig(
  kind,
  names,
  ids,
  origin,
  { assetsDir, bootstrap, identityReady = true } = {},
) {
  const base = {
    compatibility_date: kind === "request" ? "2026-09-04" : "2026-08-31",
    workers_dev: true,
  };
  if (kind === "auth")
    return {
      ...base,
      name: names.workers.auth,
      main: resolve(workspaceRoot, "apps/auth/src/index.ts"),
      compatibility_flags: ["nodejs_compat"],
      ...(identityReady
        ? {
            services: [
              { binding: "SAVIA_IDENTITY", service: names.workers.api },
            ],
          }
        : {}),
      d1_databases: [
        {
          binding: "AUTH_DB",
          database_name: names.databases.auth,
          database_id: ids.auth,
        },
      ],
      vars: {
        BETTER_AUTH_URL: origin,
        BETTER_AUTH_BOOTSTRAP_EMAIL: "savia.admin@example.test",
        BETTER_AUTH_BOOTSTRAP_PASSWORD: bootstrap?.password ?? "preview-only",
        SAVIA_API_RESOURCE: origin,
        SAVIA_ADMIN_REDIRECT_URI: `${origin}/auth/callback`,
        SAVIA_SCALAR_REDIRECT_URI: `${origin}/docs`,
      },
    };
  if (kind === "request")
    return {
      ...base,
      name: names.workers.request,
      main: resolve(workspaceRoot, "apps/savia-request/src/server/index.ts"),
      workers_dev: false,
      preview_urls: false,
      services: [
        { binding: "HOOK_SERVICE", service: names.workers.hookExecutor },
      ],
      d1_databases: [
        {
          binding: "DB",
          database_name: names.databases.domain,
          database_id: ids.domain,
        },
      ],
    };
  if (kind === "hookExecutor")
    return {
      ...base,
      name: names.workers.hookExecutor,
      main: resolve(workspaceRoot, "apps/hook-executor/src/index.ts"),
      compatibility_date: "2026-09-04",
      workers_dev: false,
      preview_urls: false,
      limits: { cpu_ms: 30000 },
      rules: [
        {
          type: "CompiledWasm",
          globs: ["**/*.wasm"],
          fallthrough: true,
        },
      ],
    };
  if (kind === "mcp")
    return {
      ...base,
      name: names.workers.mcp,
      main: resolve(workspaceRoot, "apps/mcp/src/worker.ts"),
      compatibility_flags: ["nodejs_compat"],
      services: [{ binding: "API", service: names.workers.api }],
      vars: { SAVIA_API_URL: origin },
    };
  if (kind === "api")
    return {
      ...base,
      name: names.workers.api,
      main: resolve(workspaceRoot, "apps/api/src/index.ts"),
      services: [
        { binding: "AUTH", service: names.workers.auth },
        { binding: "MCP", service: names.workers.mcp },
        { binding: "SAVIA_REQUEST", service: names.workers.request },
      ],
      d1_databases: [
        {
          binding: "DB",
          database_name: names.databases.domain,
          database_id: ids.domain,
        },
      ],
      r2_buckets: [{ binding: "DOCUMENTS", bucket_name: names.bucket }],
      vars: {
        SAVIA_API_RESOURCE: origin,
        SAVIA_OAUTH_ISSUER: `${origin}/api/auth`,
        SAVIA_PUBLIC_ORIGIN: origin,
        SAVIA_MCP_URL: `https://${names.workers.mcp}.workers.dev/mcp`,
      },
    };
  return {
    ...base,
    name: names.workers.gateway,
    main: resolve(workspaceRoot, "apps/admin/src/edge-gateway.ts"),
    services: [{ binding: "API", service: names.workers.api }],
    assets: {
      directory: assetsDir ?? resolve(workspaceRoot, "apps/admin/dist"),
      binding: "ASSETS",
      not_found_handling: "single-page-application",
      run_worker_first: [
        "/companion-downloads.json",
        "/public/bookings",
        "/public/bookings/*",
        "/api/*",
        "/v1/*",
        "/s/*",
        "/.well-known/*",
        "/health",
        "/docs",
        "/openapi.json",
      ],
    },
  };
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

async function ensureDatabase(name) {
  const listed = await runWrangler(["d1", "list", "--json"]);
  const existing = findDatabaseUuid(listed, name);
  if (existing) return { uuid: existing, created: false };
  const created = await runWrangler(["d1", "create", name, "--json"]);
  const uuid = findDatabaseUuid(created, name);
  if (!uuid) throw new Error(`Could not parse database id for ${name}`);
  return { uuid, created: true };
}

async function migrateDatabase(uuid) {
  await execFileAsync("node", ["scripts/apply-d1-migrations.mjs"], {
    cwd: workspaceRoot,
    env: { ...process.env, CLOUDFLARE_DATABASE_ID: uuid },
  });
}

async function ensureBucket(name) {
  try {
    await runWrangler(["r2", "bucket", "create", name]);
    return true;
  } catch (error) {
    if (/already exists/i.test(error.stderr ?? error.stdout ?? error.message))
      return false;
    throw error;
  }
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
  const ids = dryRun
    ? { domain: dryRunDatabaseUuid(), auth: dryRunDatabaseUuid() }
    : {
        domain: (await ensureDatabase(names.databases.domain)).uuid,
        auth: (await ensureDatabase(names.databases.auth)).uuid,
      };
  if (!dryRun) {
    await migrateDatabase(ids.domain);
    await ensureBucket(names.bucket);
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
        { cwd: workspaceRoot },
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
