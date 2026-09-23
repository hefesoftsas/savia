import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { renderProductionConfigs } from "./render-cloudflare-production-config.mjs";

const execFileAsync = promisify(execFile);
const workspaceRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

export function validatePublicOrigin(value) {
  const origin = new URL(String(value ?? "").trim());
  if (origin.protocol !== "https:")
    throw new Error("The public origin must use HTTPS");
  if (!origin.hostname.includes("."))
    throw new Error("The public origin needs a real domain");
  return origin.origin;
}

export function maskSecret(value) {
  const text = String(value ?? "");
  return text.length <= 8 ? "****" : `${text.slice(0, 3)}…${text.slice(-2)}`;
}

export function findDatabaseUuid(listOutput, name) {
  let parsed = listOutput;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return null;
    }
  }
  const rows = Array.isArray(parsed)
    ? parsed
    : (parsed?.d1_databases ?? parsed?.result ?? []);
  return (
    (Array.isArray(rows) ? rows : []).find((row) => row?.name === name)?.uuid ??
    null
  );
}

async function run(command, args, options = {}) {
  const { stdout: out } = await execFileAsync(command, args, {
    cwd: workspaceRoot,
    maxBuffer: 32 * 1024 * 1024,
    ...options,
  });
  return out;
}

const wrangler = (args, options) =>
  run("pnpm", ["--filter", "@savia/api", "exec", "wrangler", ...args], options);

async function ensureDatabase(name) {
  const existing = findDatabaseUuid(
    await wrangler(["d1", "list", "--json"]),
    name,
  );
  if (existing) return { uuid: existing, created: false };
  const created = await wrangler(["d1", "create", name, "--json"]);
  const uuid = findDatabaseUuid(created, name);
  if (!uuid) throw new Error(`Could not parse database id for ${name}`);
  return { uuid, created: true };
}

async function putSecret(app, key, value) {
  await wrangler(
    ["secret", "put", key, "--config", "wrangler.production.jsonc"],
    {
      cwd: resolve(workspaceRoot, "apps", app),
      input: `${value}\n`,
    },
  );
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--help")) {
    console.log(
      "Usage: node scripts/setup.mjs [--dry-run]\n\nInteractive first install on your Cloudflare account.\nAnswers can also come from SAVIA_SETUP_ORIGIN/BUCKET/EMAIL/NANGO_KEY/OPENROUTER_KEY/SEED.",
    );
    return;
  }
  const dryRun = argv.includes("--dry-run");
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  if (nodeMajor < 22)
    throw new Error(`Node 22+ required (found ${process.version})`);

  const io = createInterface({ input: stdin, output: stdout });
  const ask = async (name, question, fallback) => {
    const preset = process.env[`SAVIA_SETUP_${name}`];
    if (preset !== undefined) return preset.trim() || (fallback ?? "");
    if (fallback !== undefined) {
      if (!stdin.isTTY) return fallback;
    } else if (!stdin.isTTY) {
      throw new Error(`Set SAVIA_SETUP_${name} to run non-interactively`);
    }
    return (
      (
        await io.question(`${question}${fallback ? ` [${fallback}]` : ""}: `)
      ).trim() || fallback
    );
  };
  const askSecret = async (envName, question) => {
    if (process.env[envName]) return process.env[envName];
    if (!stdin.isTTY)
      throw new Error(`Set ${envName} to run non-interactively`);
    return (await io.question(`${question}: `)).trim();
  };
  try {
    console.log("Savia first install. Values in [brackets] are defaults.\n");
    const publicOrigin = validatePublicOrigin(
      await ask("ORIGIN", "Public origin (https://yourdomain.com)"),
    );
    const documentsBucket = await ask("BUCKET", "R2 bucket", "savia-documents");
    const adminEmail = await ask(
      "EMAIL",
      "Admin email",
      "savia.admin@example.test",
    );
    const apiToken = await askSecret(
      "CLOUDFLARE_API_TOKEN",
      "Cloudflare API token (Workers + D1 + R2)",
    );
    const accountId = await askSecret(
      "CLOUDFLARE_ACCOUNT_ID",
      "Cloudflare account ID",
    );
    if (!apiToken || !accountId)
      throw new Error("API token and account ID are required");
    process.env.CLOUDFLARE_API_TOKEN = apiToken;
    process.env.CLOUDFLARE_ACCOUNT_ID = accountId;
    console.log(`using API token ${maskSecret(apiToken)}`);
    const cloudEnv = {
      ...process.env,
      CLOUDFLARE_API_TOKEN: apiToken,
      CLOUDFLARE_ACCOUNT_ID: accountId,
    };
    const nangoKey = await ask(
      "NANGO_KEY",
      "Nango API key (empty = provider live paths disabled)",
      "",
    );
    const openRouterKey = await ask(
      "OPENROUTER_KEY",
      "OpenRouter API key (empty = assistant disabled)",
      "",
    );
    const seedDemo =
      (
        await ask("SEED", "Seed demo data at the end? [Y/n]", "Y")
      ).toLowerCase() !== "n";

    const secrets = {
      BETTER_AUTH_SECRET: randomBytes(32).toString("base64"),
      ENCRYPTION_KEY: randomBytes(32).toString("base64"),
      ASSISTANT_SETTINGS_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
      STUDIO_INTEGRATION_KEY: randomBytes(32).toString("base64"),
      SAVIA_MCP_SHARED_SECRET: randomBytes(32).toString("base64"),
    };
    const bootstrapPassword = randomBytes(24).toString("base64");

    console.log("\nPlan:");
    console.log(`  origin ......... ${publicOrigin}`);
    console.log(`  D1 ............. savia-auth + savia-agencies`);
    console.log(`  R2 ............. ${documentsBucket}`);
    console.log(`  admin .......... ${adminEmail}`);
    console.log(`  nango .......... ${nangoKey ? "configured" : "skipped"}`);
    console.log(
      `  openrouter ..... ${openRouterKey ? "configured" : "skipped"}`,
    );
    console.log(`  demo seed ...... ${seedDemo ? "yes" : "no"}`);
    if (dryRun) {
      console.log("\nDry run: no cloud changes were made.");
      return;
    }

    console.log("\n[1/8] Creating D1 databases…");
    const authDb = await ensureDatabase("savia-auth");
    const domainDb = await ensureDatabase("savia-agencies");
    console.log(
      `      auth: ${authDb.uuid}${authDb.created ? " (created)" : " (exists)"}`,
    );
    console.log(
      `      domain: ${domainDb.uuid}${domainDb.created ? " (created)" : " (exists)"}`,
    );

    console.log("[2/8] Creating R2 bucket…");
    try {
      await wrangler(["r2", "bucket", "create", documentsBucket], {
        env: cloudEnv,
      });
    } catch (error) {
      if (!/already exists/i.test(String(error.stderr ?? error.message)))
        throw error;
      console.log("      bucket already exists");
    }

    console.log("[3/8] Rendering worker configs…");
    await renderProductionConfigs({
      authD1Id: authDb.uuid,
      domainD1Id: domainDb.uuid,
      documentsBucket,
      outputRoot: workspaceRoot,
      publicOrigin,
    });

    console.log("[4/8] Storing secrets…");
    await putSecret("auth", "BETTER_AUTH_SECRET", secrets.BETTER_AUTH_SECRET);
    await putSecret(
      "mcp",
      "SAVIA_MCP_SHARED_SECRET",
      secrets.SAVIA_MCP_SHARED_SECRET,
    );
    await putSecret("savia-request", "ENCRYPTION_KEY", secrets.ENCRYPTION_KEY);
    for (const key of [
      "ASSISTANT_SETTINGS_ENCRYPTION_KEY",
      "STUDIO_INTEGRATION_KEY",
      "SAVIA_MCP_SHARED_SECRET",
    ]) {
      await putSecret("api", key, secrets[key]);
    }
    if (nangoKey) await putSecret("api", "NANGO_API_KEY", nangoKey);

    console.log("[5/8] Applying domain migrations…");
    await execFileAsync("node", ["scripts/apply-d1-migrations.mjs"], {
      cwd: workspaceRoot,
      env: { ...cloudEnv, CLOUDFLARE_DATABASE_ID: domainDb.uuid },
    });

    console.log("[6/8] Deploying workers…");
    for (const pkg of ["auth", "mcp", "savia-request", "api"]) {
      await wrangler(["deploy", "--config", "wrangler.production.jsonc"], {
        cwd: resolve(workspaceRoot, "apps", pkg),
        env: cloudEnv,
      });
      console.log(`      deployed ${pkg}`);
    }
    await execFileAsync("pnpm", ["--filter", "@savia/admin", "run", "build"], {
      cwd: workspaceRoot,
      env: cloudEnv,
    });
    await wrangler(["deploy", "--config", "wrangler.production.jsonc"], {
      cwd: resolve(workspaceRoot, "apps/admin"),
      env: cloudEnv,
    });
    console.log("      deployed admin gateway");

    console.log("[7/8] Seeding bootstrap admin…");
    await wrangler(
      [
        "deploy",
        "--config",
        "wrangler.production.jsonc",
        "--var",
        `BETTER_AUTH_BOOTSTRAP_EMAIL:${adminEmail}`,
        "--var",
        `BETTER_AUTH_BOOTSTRAP_PASSWORD:${bootstrapPassword}`,
      ],
      { cwd: resolve(workspaceRoot, "apps/auth"), env: cloudEnv },
    );
    await fetch(`${publicOrigin}/api/auth/get-session`);
    await wrangler(["deploy", "--config", "wrangler.production.jsonc"], {
      cwd: resolve(workspaceRoot, "apps/auth"),
      env: cloudEnv,
    });

    if (seedDemo) {
      console.log("[8/8] Seeding demo data…");
      await execFileAsync(
        "node",
        [
          "scripts/seed-demo.mjs",
          "--origin",
          publicOrigin,
          "--email",
          adminEmail,
          "--password",
          bootstrapPassword,
        ],
        { cwd: workspaceRoot },
      );
    } else {
      console.log("[8/8] Skipped demo seed.");
    }

    console.log(`\nDone. Open ${publicOrigin} and log in as ${adminEmail}`);
    console.log(`Bootstrap password (shown once): ${bootstrapPassword}`);
    if (!openRouterKey)
      console.log("Assistant is disabled (no OpenRouter key).");
  } finally {
    io.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
