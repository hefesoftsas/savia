import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { access, mkdtemp, mkdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import { createInterface } from "node:readline";
import { encryptBackup } from "./encrypt-flows-backup.mjs";
import { validateManifest } from "../infra/pulumi/restore.mjs";

const D1_ID =
  /^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;
const ACCOUNT_ID = /^[a-f\d]{32}$/i;
const HASH = /^[a-f\d]{64}$/i;
const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;

function childExit(child) {
  return new Promise((resolveExit, rejectExit) => {
    child.once("error", rejectExit);
    child.once("close", (exitCode, signal) =>
      signal ? rejectExit(new Error("tar terminated")) : resolveExit(exitCode),
    );
  }).catch((error) => ({ error }));
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!["--input", "--output", "--environment"].includes(flag))
      throw new Error("Unknown extraction option");
    if (values[flag]) throw new Error("Duplicate extraction option");
    const value = argv[++index];
    if (!value || value.startsWith("--"))
      throw new Error("Missing extraction option value");
    values[flag] = value;
  }
  const environment = values["--environment"];
  if (!values["--input"] || !values["--output"])
    throw new Error("Input and output paths are required");
  if (!["preview", "production"].includes(environment))
    throw new Error("A supported environment is required");
  return {
    inputPath: values["--input"],
    outputPath: values["--output"],
    environment,
  };
}

function safeFile(path, label) {
  if (typeof path !== "string" || !isAbsolute(path))
    throw new Error(`${label} path must be absolute`);
  return resolve(path);
}

function checkKey(value) {
  if (!/^[a-f\d]{64}$/i.test(value ?? ""))
    throw new Error("Required backup keys must be 256-bit hex values");
}

async function assertAbsent(path) {
  try {
    await access(path);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw new Error("Output path is unavailable");
  }
  throw new Error("Output file already exists");
}

async function archiveMemberCounts(archivePath, requestedMembers) {
  const child = spawn("tar", ["-tzf", archivePath], {
    stdio: ["ignore", "pipe", "ignore"],
  });
  const exit = childExit(child);
  const counts = new Map(requestedMembers.map((member) => [member, 0]));
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (line.length > 4096) continue;
      if (counts.has(line)) counts.set(line, counts.get(line) + 1);
    }
    const result = await exit;
    if (result?.error || result !== 0)
      throw new Error("Archive listing failed");
    return counts;
  } catch {
    child.kill();
    throw new Error("Recovery archive format is invalid");
  }
}

async function readArchiveMember(archivePath, member) {
  const child = spawn("tar", ["-xOzf", archivePath, member], {
    stdio: ["ignore", "pipe", "ignore"],
  });
  const exit = childExit(child);
  const chunks = [];
  let bytes = 0;
  for await (const chunk of child.stdout) {
    bytes += chunk.length;
    if (bytes > MAX_MANIFEST_BYTES) {
      child.kill();
      throw new Error("Recovery manifest is too large");
    }
    chunks.push(chunk);
  }
  const result = await exit;
  if (result?.error || result !== 0)
    throw new Error("Recovery manifest is missing");
  return Buffer.concat(chunks, bytes);
}

async function extractArchiveMember(archivePath, member, destination) {
  const child = spawn("tar", ["-xOzf", archivePath, member], {
    stdio: ["ignore", "pipe", "ignore"],
  });
  const exit = new Promise((resolveExit, rejectExit) => {
    child.once("error", rejectExit);
    child.once("close", (exitCode, signal) =>
      signal ? rejectExit(new Error("tar terminated")) : resolveExit(exitCode),
    );
  });
  try {
    await pipeline(
      child.stdout,
      createWriteStream(destination, { flags: "wx", mode: 0o600 }),
    );
    const result = await exit;
    if (result?.error || result !== 0)
      throw new Error("Auth database extraction failed");
  } catch {
    child.kill();
    throw new Error("Auth database extraction failed");
  }
}

function validateAuthManifest(manifest, environment, env) {
  try {
    validateManifest(manifest, environment, env.CLOUDFLARE_ACCOUNT_ID);
  } catch {
    throw new Error(
      "Recovery manifest does not match the selected environment",
    );
  }
  const name = environment === "preview" ? "savia-auth-preview" : "savia-auth";
  const path = `d1/${name}.sql`;
  const outputs = manifest?.pulumiOutputs;
  if (
    manifest?.version !== 2 ||
    outputs?.databaseNames?.auth !== name ||
    manifest?.d1?.[name] !== path ||
    !["export", "schema-dump"].includes(manifest?.d1Methods?.[name]) ||
    (environment === "production" &&
      manifest?.d1Methods?.[name] !== "schema-dump") ||
    !ACCOUNT_ID.test(outputs?.cloudflareAccountId ?? "") ||
    !D1_ID.test(outputs?.authD1Id ?? "") ||
    (env.SAVIA_AUTH_D1_ID && outputs.authD1Id !== env.SAVIA_AUTH_D1_ID) ||
    !HASH.test(manifest?.integrity?.[path] ?? "")
  )
    throw new Error(
      "Recovery manifest has an unexpected Auth database identity",
    );
  return { name, path, expectedHash: manifest.integrity[path] };
}

export async function extractAuthRecovery({
  inputPath,
  outputPath,
  environment,
  env = process.env,
  workRoot = env.RUNNER_TEMP || tmpdir(),
} = {}) {
  const input = safeFile(inputPath, "Input"),
    output = safeFile(outputPath, "Output"),
    temporaryRoot = safeFile(workRoot, "Temporary directory");
  if (input === output) throw new Error("Input and output paths must differ");
  if (!["preview", "production"].includes(environment))
    throw new Error("A supported environment is required");
  if (env.CLOUDFLARE_ACCOUNT_ID && !ACCOUNT_ID.test(env.CLOUDFLARE_ACCOUNT_ID))
    throw new Error("Expected Cloudflare account identity is invalid");
  if (env.SAVIA_AUTH_D1_ID && !D1_ID.test(env.SAVIA_AUTH_D1_ID))
    throw new Error("Expected Auth database identity is invalid");
  checkKey(env.SAVIA_BACKUP_KEY);
  checkKey(env.SAVIA_FLOWS_BACKUP_KEY);
  await assertAbsent(output);
  const inputInfo = await stat(input).catch(() => null);
  if (!inputInfo?.isFile()) throw new Error("Input backup file is unavailable");
  if (input === temporaryRoot || output === temporaryRoot)
    throw new Error("File path cannot be a temporary directory");

  await mkdir(temporaryRoot, { recursive: true, mode: 0o700 });
  const work = await mkdtemp(join(temporaryRoot, "savia-auth-recovery-"));
  const archive = join(work, "recovery.tar.gz"),
    authSqlFile = join(work, "auth.sql");
  try {
    await encryptBackup(input, archive, env.SAVIA_BACKUP_KEY, true);
    const root =
      environment === "preview" ? "flows-release-backup" : "production-backup";
    const manifestMember = `${root}/manifest.json`;
    const manifestBuffer = await readArchiveMember(archive, manifestMember);
    let manifest;
    try {
      manifest = JSON.parse(manifestBuffer.toString("utf8"));
    } catch {
      throw new Error("Recovery manifest is invalid");
    }
    const auth = validateAuthManifest(manifest, environment, env),
      authMember = `${root}/${auth.path}`;
    const counts = await archiveMemberCounts(archive, [
      manifestMember,
      authMember,
    ]);
    if (counts.get(manifestMember) !== 1 || counts.get(authMember) !== 1)
      throw new Error(
        "Recovery archive does not contain one Auth SQL file and manifest",
      );
    await extractArchiveMember(archive, authMember, authSqlFile);
    const sqlHash = createHash("sha256")
      .update(await readFile(authSqlFile))
      .digest("hex");
    if (sqlHash !== auth.expectedHash)
      throw new Error("Auth SQL integrity check failed");
    await mkdir(dirname(output), { recursive: true, mode: 0o700 });
    await encryptBackup(authSqlFile, output, env.SAVIA_FLOWS_BACKUP_KEY);
    return { outputPath: output, environment, databaseName: auth.name };
  } catch {
    // encryptBackup removes a partial destination on failure. Never remove
    // this path here because another process could create it after preflight.
    throw new Error(
      "Auth recovery extraction failed; sensitive details withheld",
    );
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const result = await extractAuthRecovery({
      ...parseArgs(process.argv.slice(2)),
      env: process.env,
    });
    console.log(`Encrypted ${result.databaseName} recovery data is ready.`);
  } catch (error) {
    const message =
      error instanceof Error &&
      /^(?:Input|Output|Temporary|Expected|Required|A supported|Unknown|Duplicate|Missing|File|Input and|Output file)/.test(
        error.message,
      )
        ? error.message
        : "Auth recovery extraction failed; sensitive details withheld";
    console.error(message);
    process.exitCode = 1;
  }
}
