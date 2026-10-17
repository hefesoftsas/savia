import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  access,
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  createBackup,
  d1BackupTargets,
  parseBackupArgs,
} from "../infra/pulumi/backup.mjs";
import { isRecoveryConsistencyDrift } from "../infra/pulumi/recovery-consistency.mjs";
import {
  buildR2ObjectRestorePlan,
  readSidecar,
  resolveManifestPath,
  validateManifest,
  verifyManifestIntegrity,
} from "../infra/pulumi/restore.mjs";
import { encryptBackup } from "./encrypt-flows-backup.mjs";

import { withProductionBackupGate } from "./production-backup-gate.mjs";

const execFileAsync = promisify(execFile);
const DEFAULT_MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [60_000, 120_000];

async function sha256File(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

function parseArgs(argv) {
  const value = (flag) => {
    const index = argv.indexOf(flag);
    if (index === -1 || !argv[index + 1] || argv[index + 1].startsWith("--")) {
      throw new Error(`Missing required flag: ${flag} <path>`);
    }
    return argv[index + 1];
  };
  const artifactPath = resolve(value("--artifact"));
  const workRootIndex = argv.indexOf("--work-root");
  const workRoot =
    workRootIndex === -1 ? tmpdir() : resolve(value("--work-root"));
  const snapshotIndex = argv.indexOf("--flows-snapshot");
  const flowsSnapshot =
    snapshotIndex === -1 ? null : resolve(value("--flows-snapshot"));
  return { artifactPath, workRoot, flowsSnapshot };
}

function appendSummary(summaryPath, lines) {
  if (!summaryPath) return Promise.resolve();
  return appendFile(summaryPath, `${lines.join("\n")}\n`, { mode: 0o600 });
}

async function ensureAbsent(path) {
  try {
    await access(path);
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  throw new Error("Backup artifact path already exists");
}

async function assertCompleteProductionCapture(manifest, manifestPath) {
  if (manifest.version !== 2)
    throw new Error(
      "Production recovery requires a version 2 integrity manifest",
    );
  const outputs = manifest.pulumiOutputs;
  const expectedD1 = Object.keys(d1BackupTargets(outputs)).sort();
  const actualD1 = Object.keys(manifest.d1 ?? {}).sort();
  const actualMethods = Object.keys(manifest.d1Methods ?? {}).sort();
  if (
    JSON.stringify(actualD1) !== JSON.stringify(expectedD1) ||
    JSON.stringify(actualMethods) !== JSON.stringify(expectedD1)
  ) {
    throw new Error(
      "Production recovery manifest does not contain every D1 database and method",
    );
  }

  const r2Entries = [
    { kind: "documents", backup: manifest.r2 },
    ...Object.entries(manifest.r2Buckets ?? {}).map(([kind, backup]) => ({
      kind,
      backup,
    })),
  ];
  if (!manifest.r2 || manifest.r2.bucket !== outputs.documentsBucketName) {
    throw new Error(
      "Production recovery manifest is missing the documents R2 backup",
    );
  }
  const expectedBucketCount = outputs.flowsEnabled ? 4 : 1;
  if (r2Entries.length !== expectedBucketCount) {
    throw new Error(
      "Production recovery manifest does not contain every R2 bucket",
    );
  }
  for (const { backup } of r2Entries) {
    if (
      !backup ||
      !["object-get", "s3-sync"].includes(backup.method) ||
      !Number.isSafeInteger(backup.objects) ||
      backup.objects < 0
    ) {
      throw new Error("Production recovery R2 inventory is incomplete");
    }
    const metadataFile = resolveManifestPath(manifestPath, backup.metadataFile);
    const sourceDir = resolveManifestPath(manifestPath, backup.path);
    const sidecar = await readSidecar(metadataFile);
    await buildR2ObjectRestorePlan({
      bucket: backup.bucket,
      sourceDir,
      sidecar,
      accountId: outputs.cloudflareAccountId,
      expectedObjects: backup.objects,
    });
  }
}

/**
 * Capture a restore-ready production backup, retrying only consistency drift.
 * The command and sleep adapters keep this workflow logic testable without
 * making live Cloudflare or Pulumi calls.
 */
export async function runProductionBackup({
  artifactPath,
  workRoot = tmpdir(),
  flowsSnapshot = null,
  env = process.env,
  captureBackup = createBackup,
  withGate = withProductionBackupGate,
  run = execFileAsync,
  encrypt = encryptBackup,
  sleep = (milliseconds) =>
    new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds)),
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  retryDelaysMs = RETRY_DELAYS_MS,
  summaryPath = env.GITHUB_STEP_SUMMARY,
  tar = (args) => execFileAsync("tar", args),
}) {
  if (!artifactPath || !isAbsolute(artifactPath))
    throw new Error("A fully qualified backup artifact path is required");
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 3)
    throw new Error("Production backup attempts must be between one and three");
  if (!Array.isArray(retryDelaysMs) || retryDelaysMs.length < maxAttempts - 1)
    throw new Error("Production backup retry delays are incomplete");
  if (!/^[a-f0-9]{64}$/i.test(env.SAVIA_BACKUP_KEY ?? ""))
    throw new Error("SAVIA_BACKUP_KEY must be configured as a 256-bit hex key");

  const output = resolve(artifactPath);
  const base = resolve(workRoot);
  await ensureAbsent(output);
  await mkdir(dirname(output), { recursive: true, mode: 0o700 });
  await mkdir(base, { recursive: true, mode: 0o700 });
  const runRoot = await mkdtemp(join(base, "savia-production-backup-"));
  let artifactCreated = false;
  let successfulAttempt = 0;

  try {
    let manifest;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const outDir = join(runRoot, `capture-${attempt}`);
      const argv = ["--stack", "production", "--apply", "--out-dir", outDir];
      if (flowsSnapshot) {
        argv.push(
          "--confirm-quiescent",
          "production",
          "--flows-snapshot",
          flowsSnapshot,
        );
      }
      try {
        manifest = await withGate(
          () => captureBackup(parseBackupArgs(argv), { env, run }),
          { env },
        );
      } catch (error) {
        await rm(outDir, { recursive: true, force: true });
        if (!isRecoveryConsistencyDrift(error) || attempt === maxAttempts) {
          await appendSummary(summaryPath, [
            "## Production backup failed",
            `Capture stopped on attempt ${attempt} of ${maxAttempts}.`,
            isRecoveryConsistencyDrift(error)
              ? "The consistency check continued to detect writes after all bounded retries. No artifact was produced."
              : "A permanent capture or configuration error stopped the backup. No artifact was produced.",
          ]);
          throw error;
        }
        await appendSummary(summaryPath, [
          `Production backup capture detected concurrent writes on attempt ${attempt}; retrying after a bounded delay.`,
        ]);
        await sleep(retryDelaysMs[attempt - 1]);
        continue;
      }

      if (!manifest || manifest.stack !== "production") {
        await rm(outDir, { recursive: true, force: true });
        throw new Error(
          "Production capture did not return a production manifest",
        );
      }
      const manifestPath = join(outDir, "manifest.json");
      const committedManifest = JSON.parse(
        await readFile(manifestPath, "utf8"),
      );
      validateManifest(
        committedManifest,
        "production",
        env.CLOUDFLARE_ACCOUNT_ID,
      );
      await verifyManifestIntegrity(committedManifest, manifestPath);
      await assertCompleteProductionCapture(committedManifest, manifestPath);
      if (committedManifest.recoveryConsistency === undefined) {
        throw new Error(
          "Production capture manifest is missing its consistency proof",
        );
      }
      manifest = committedManifest;
      successfulAttempt = attempt;
      break;
    }

    if (!manifest || successfulAttempt === 0)
      throw new Error("Production backup capture did not complete");

    const captureDir = join(runRoot, `capture-${successfulAttempt}`);
    const backupRoot = join(runRoot, "production-backup");
    const archivePath = join(runRoot, "production-backup.tar.gz");
    const verificationPath = join(runRoot, "production-backup.verify.tar.gz");
    await rename(captureDir, backupRoot);
    await tar(["-czf", archivePath, "-C", runRoot, "production-backup"]);
    const archiveSize = (await stat(archivePath)).size;
    if (archiveSize === 0)
      throw new Error("Production backup archive is empty");
    await encrypt(archivePath, output, env.SAVIA_BACKUP_KEY, false);
    artifactCreated = true;
    await encrypt(output, verificationPath, env.SAVIA_BACKUP_KEY, true);
    if (
      (await sha256File(archivePath)) !== (await sha256File(verificationPath))
    ) {
      throw new Error("Encrypted production backup failed its integrity check");
    }
    await rm(backupRoot, { recursive: true, force: true });
    await rm(archivePath, { force: true });
    await rm(verificationPath, { force: true });
    await appendSummary(summaryPath, [
      "## Production backup ready",
      `Verified and encrypted production recovery data after ${successfulAttempt} capture attempt${successfulAttempt === 1 ? "" : "s"}.`,
      "The encrypted artifact is ready for 30-day retention.",
    ]);
    return { artifactPath: output, attempts: successfulAttempt, manifest };
  } catch (error) {
    if (artifactCreated) await rm(output, { force: true });
    await appendSummary(summaryPath, [
      "## Production backup failed",
      "Validation, encryption, or encryption verification failed. No artifact was retained.",
    ]).catch(() => {});
    throw error;
  } finally {
    await rm(runRoot, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runProductionBackup(parseArgs(process.argv.slice(2))).catch(() => {
    process.stderr.write(
      "Production backup failed; see the step summary for the failure category.\n",
    );
    process.exitCode = 1;
  });
}
