// Restore a stack from a backup manifest written by backup.mjs.
// Flow for disaster recovery:
//   1. pulumi up recreates empty D1 databases + R2 bucket (idempotent).
//   2. D1 SQL exports are loaded back with wrangler d1 execute --file.
//   3. R2 objects are synced back with AWS CLI.
// Afterwards run scripts/apply-d1-migrations.mjs to catch up with any
// migrations newer than the backup, then redeploy workers via CI.
import { execFile } from "node:child_process";
import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { buildR2ObjectPutCommand } from "./backup.mjs";
import { assertAccountId, assertSafeR2Key } from "./naming.mjs";

const execFileAsync = promisify(execFile);

export function parseRestoreArgs(argv) {
  const manifest = flagValue(argv, "--manifest");
  const dryRun = argv.includes("--dry-run");
  const apply = argv.includes("--apply");
  const skipInfra = argv.includes("--skip-infra");
  const skipMigrations = argv.includes("--skip-migrations");
  if (!dryRun && !apply) {
    throw new Error(
      "Refusing to restore without --apply (or use --dry-run to plan)",
    );
  }
  const confirmIndex = argv.indexOf("--confirm-restore");
  const confirm =
    confirmIndex !== -1 && argv[confirmIndex + 1]
      ? argv[confirmIndex + 1]
      : null;
  if (!dryRun && !confirm) {
    throw new Error(
      "Restore requires --confirm-restore <preview|production>",
    );
  }
  return { manifest, dryRun, skipInfra, skipMigrations, confirm };
}

// Table dumps carry data but no schema: migrations must create tables,
// triggers, and the FTS5 definition before the dump is loaded (and the
// FTS5 index rebuilds via triggers on INSERT).
export function needsMigrations(manifest) {
  return Object.values(manifest?.d1Methods ?? {}).includes("table-dump");
}

// Reads the R2 metadata sidecar written by the object-get backup.
// Returns {} when the backup used s3-sync (metadata preserved natively)
// or the sidecar is missing.
export async function readSidecar(metadataFile) {
  if (!metadataFile) return {};
  try {
    return JSON.parse(await readFile(metadataFile, "utf8"));
  } catch {
    return {};
  }
}

// Lists files under dir as slash-separated keys (R2 object names).
export async function listLocalFiles(dir, base = dir) {
  const entries = [];
  for (const name of await readdir(dir)) {
    const full = join(dir, name);
    if ((await stat(full)).isDirectory()) {
      entries.push(...(await listLocalFiles(full, base)));
    } else {
      entries.push(relative(base, full).split(sep).join("/"));
    }
  }
  return entries.sort();
}

function flagValue(argv, flag) {
  const index = argv.indexOf(flag);
  if (index === -1 || index + 1 >= argv.length)
    throw new Error(`Missing required flag: ${flag} <value>`);
  const value = argv[index + 1];
  if (typeof value !== "string" || value.startsWith("--") || value === "")
    throw new Error(`Missing required flag: ${flag} <value>`);
  return value;
}

export function validateManifest(manifest, confirm) {
  if (!manifest || manifest.version !== 1)
    throw new Error("Unsupported backup manifest version");
  if (typeof manifest.stack !== "string" || !manifest.stack)
    throw new Error("Backup manifest is missing its stack");
  if (confirm && manifest.stack !== confirm) {
    throw new Error(
      `Manifest is for stack ${manifest.stack}, not ${confirm}. Refusing.`,
    );
  }
  if (!manifest.d1 || typeof manifest.d1 !== "object")
    throw new Error("Backup manifest is missing D1 files");
  return manifest;
}

// wrangler d1 execute <name> --remote --file <sql>
export function buildD1ExecuteCommand(dbName, sqlFile) {
  if (!dbName || !sqlFile) throw new Error("dbName and sqlFile required");
  return [
    "pnpm",
    [
      "--filter",
      "@savia/api",
      "exec",
      "wrangler",
      "d1",
      "execute",
      dbName,
      "--remote",
      "--file",
      sqlFile,
    ],
  ];
}

// aws s3 sync <dir> s3://<bucket> --endpoint-url https://<account>.r2.cloudflarestorage.com
export function buildR2RestoreCommand({ bucket, sourceDir, accountId }) {
  if (!bucket || !sourceDir) throw new Error("bucket and sourceDir required");
  assertAccountId(accountId);
  return [
    "aws",
    [
      "s3",
      "sync",
      sourceDir,
      `s3://${bucket}`,
      "--endpoint-url",
      `https://${accountId}.r2.cloudflarestorage.com`,
    ],
  ];
}

async function main() {
  const plan = parseRestoreArgs(process.argv.slice(2));
  const manifest = validateManifest(
    JSON.parse(await readFile(plan.manifest, "utf8")),
    plan.confirm,
  );
  const pulumiCwd = fileURLToPath(new URL(".", import.meta.url));
  const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
  const dbNames = manifest.pulumiOutputs.databaseNames;
  const bucket = manifest.pulumiOutputs.documentsBucketName;

  if (plan.dryRun) {
    console.log(
      `Would restore stack ${manifest.stack} from ${plan.manifest}`,
    );
    if (!plan.skipInfra) console.log(`Would run: pulumi up --stack ${manifest.stack} --yes`);
    console.log(`Would load D1: ${Object.keys(manifest.d1).join(", ")}`);
    if (manifest.r2) console.log(`Would sync R2 bucket back: ${bucket}`);
    return;
  }
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (manifest.r2 && !accountId)
    throw new Error("CLOUDFLARE_ACCOUNT_ID is required for R2 restore");

  if (!plan.skipInfra) {
    await execFileAsync("pulumi", ["up", "--stack", manifest.stack, "--yes"], {
      cwd: pulumiCwd,
      stdio: "inherit",
    });
  }
  if (needsMigrations(manifest) && !plan.skipMigrations) {
    await execFileAsync("node", ["scripts/apply-d1-migrations.mjs"], {
      cwd: repoRoot,
      env: {
        ...process.env,
        CLOUDFLARE_DATABASE_ID: manifest.pulumiOutputs.domainD1Id,
      },
    });
    console.log("Applied D1 migrations before loading table dumps");
  }
  for (const [dbName, sqlFile] of Object.entries(manifest.d1)) {
    const [command, args] = buildD1ExecuteCommand(
      dbNames[dbName] ?? dbName,
      sqlFile,
    );
    await execFileAsync(command, args, { cwd: repoRoot });
    console.log(`Restored D1 ${dbName}`);
  }
  if (manifest.r2) {
    if (manifest.r2.method === "object-get") {
      const sidecar = await readSidecar(manifest.r2.metadataFile);
      if (
        Object.values(sidecar).some(
          (meta) => Object.keys(meta?.customMetadata ?? {}).length > 0,
        )
      ) {
        console.log(
          "WARNING: backup holds customMetadata that wrangler put cannot reapply; reapply it manually from r2-metadata.json",
        );
      }
      for (const key of await listLocalFiles(manifest.r2.path)) {
        assertSafeR2Key(key);
        const meta = sidecar[key] ?? {};
        const [command, args] = buildR2ObjectPutCommand({
          bucket,
          key,
          sourceFile: join(manifest.r2.path, ...key.split("/")),
          contentType: meta.httpMetadata?.contentType,
          contentEncoding: meta.httpMetadata?.contentEncoding,
        });
        await execFileAsync(command, args, { cwd: repoRoot });
      }
      console.log(`Restored R2 ${bucket} object by object`);
    } else {
      const [command, args] = buildR2RestoreCommand({
        bucket,
        sourceDir: manifest.r2.path,
        accountId,
      });
      await execFileAsync(command, args, { cwd: repoRoot });
      console.log(`Restored R2 ${bucket}`);
    }
  }
  console.log(
    "Restore complete. Next: node scripts/apply-d1-migrations.mjs, then redeploy workers via CI.",
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
