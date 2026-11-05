import assert from "node:assert/strict";
import test from "node:test";
import {
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { hashBackupFiles, manifestFor } from "../infra/pulumi/backup.mjs";
import { encryptBackup } from "./encrypt-flows-backup.mjs";
import { extractAuthRecovery } from "./extract-auth-recovery.mjs";

const execFileAsync = promisify(execFile);
const BACKUP_KEY = "11".repeat(32);
const FLOWS_KEY = "22".repeat(32);
const ACCOUNT_ID = "a".repeat(32);
const AUTH_D1_ID = "11111111-1111-4111-8111-111111111111";
const DOMAIN_D1_ID = "22222222-2222-4222-8222-222222222222";

async function createPreviewArchive(root, { tamperHash = false } = {}) {
  const backupRoot = join(root, "flows-release-backup"),
    sql = "CREATE TABLE auth_fixture (id INTEGER PRIMARY KEY);\n";
  await mkdir(join(backupRoot, "d1"), { recursive: true, mode: 0o700 });
  await mkdir(join(backupRoot, "r2-metadata"), {
    recursive: true,
    mode: 0o700,
  });
  await mkdir(join(backupRoot, "r2", "documents"), {
    recursive: true,
    mode: 0o700,
  });
  await writeFile(join(backupRoot, "d1", "savia-auth-preview.sql"), sql);
  await writeFile(
    join(backupRoot, "d1", "savia-agencies-preview.sql"),
    "SELECT 1;\n",
  );
  await writeFile(join(backupRoot, "r2-metadata", "documents.json"), "{}\n");
  const integrity = await hashBackupFiles(backupRoot);
  if (tamperHash) integrity["d1/savia-auth-preview.sql"] = "0".repeat(64);
  const outputs = {
    cloudflareAccountId: ACCOUNT_ID,
    authD1Id: AUTH_D1_ID,
    domainD1Id: DOMAIN_D1_ID,
    documentsBucketName: "savia-documents-preview",
    resolvedEnvironment: "preview",
    resolvedPublicOrigin: "https://savia-preview.hefesoft.com",
    databaseNames: {
      auth: "savia-auth-preview",
      domain: "savia-agencies-preview",
    },
    flowsEnabled: false,
    flowsResources: null,
  };
  const manifest = manifestFor({
    stack: "preview",
    outputs,
    files: {
      "savia-auth-preview": "d1/savia-auth-preview.sql",
      "savia-agencies-preview": "d1/savia-agencies-preview.sql",
    },
    methods: {
      "savia-auth-preview": "export",
      "savia-agencies-preview": "export",
    },
    r2: {
      bucket: "savia-documents-preview",
      path: "r2/documents",
      metadataFile: "r2-metadata/documents.json",
      method: "object-get",
      objects: 0,
    },
    integrity,
  });
  await writeFile(
    join(backupRoot, "manifest.json"),
    `${JSON.stringify(manifest)}\n`,
  );
  const archive = join(root, "source.tar.gz");
  await execFileAsync("tar", [
    "-czf",
    archive,
    "-C",
    root,
    "flows-release-backup",
  ]);
  const encrypted = join(root, "source.enc");
  await encryptBackup(archive, encrypted, BACKUP_KEY);
  return { encrypted, sql };
}

function environment(overrides = {}) {
  return {
    SAVIA_BACKUP_KEY: BACKUP_KEY,
    SAVIA_FLOWS_BACKUP_KEY: FLOWS_KEY,
    CLOUDFLARE_ACCOUNT_ID: ACCOUNT_ID,
    SAVIA_AUTH_D1_ID: AUTH_D1_ID,
    ...overrides,
  };
}

test("extracts and re-encrypts only the validated preview Auth SQL", async () => {
  const root = await mkdtemp(join(tmpdir(), "savia-auth-recovery-test-"));
  try {
    const { encrypted, sql } = await createPreviewArchive(root),
      workRoot = join(root, "private-work"),
      output = join(root, "auth-diagnosis.enc");
    await mkdir(workRoot, { mode: 0o700 });
    await chmod(workRoot, 0o700);
    const result = await extractAuthRecovery({
      inputPath: encrypted,
      outputPath: output,
      environment: "preview",
      env: environment(),
      workRoot,
    });
    assert.equal(result.databaseName, "savia-auth-preview");
    assert.equal((await stat(output)).mode & 0o777, 0o600);
    const decryptedOutput = join(root, "verified-auth.sql");
    await encryptBackup(output, decryptedOutput, FLOWS_KEY, true);
    assert.equal(await readFile(decryptedOutput, "utf8"), sql);
    assert.deepEqual(await readdir(workRoot), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects a mismatched Auth database identity and cleans plaintext", async () => {
  const root = await mkdtemp(
    join(tmpdir(), "savia-auth-recovery-identity-test-"),
  );
  try {
    const { encrypted } = await createPreviewArchive(root),
      workRoot = join(root, "private-work"),
      output = join(root, "auth-diagnosis.enc");
    await mkdir(workRoot, { mode: 0o700 });
    await assert.rejects(
      extractAuthRecovery({
        inputPath: encrypted,
        outputPath: output,
        environment: "preview",
        env: environment({ SAVIA_AUTH_D1_ID: DOMAIN_D1_ID }),
        workRoot,
      }),
      /sensitive details withheld/,
    );
    assert.deepEqual(await readdir(workRoot), []);
    await assert.rejects(readFile(output));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects an Auth SQL integrity mismatch before writing output", async () => {
  const root = await mkdtemp(
    join(tmpdir(), "savia-auth-recovery-integrity-test-"),
  );
  try {
    const { encrypted } = await createPreviewArchive(root, {
        tamperHash: true,
      }),
      workRoot = join(root, "private-work"),
      output = join(root, "auth-diagnosis.enc");
    await mkdir(workRoot, { mode: 0o700 });
    await assert.rejects(
      extractAuthRecovery({
        inputPath: encrypted,
        outputPath: output,
        environment: "preview",
        env: environment(),
        workRoot,
      }),
      /sensitive details withheld/,
    );
    assert.deepEqual(await readdir(workRoot), []);
    await assert.rejects(readFile(output));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("CLI accepts the documented arguments and environment contract", async () => {
  const root = await mkdtemp(join(tmpdir(), "savia-auth-recovery-cli-test-"));
  try {
    const { encrypted, sql } = await createPreviewArchive(root),
      output = join(root, "auth-diagnosis.enc"),
      run = await execFileAsync(
        process.execPath,
        [
          "scripts/extract-auth-recovery.mjs",
          "--input",
          encrypted,
          "--output",
          output,
          "--environment",
          "preview",
        ],
        {
          cwd: process.cwd(),
          env: { ...process.env, ...environment() },
        },
      );
    assert.match(run.stdout, /savia-auth-preview recovery data is ready/);
    assert.equal(run.stderr, "");
    const decryptedOutput = join(root, "verified-cli-auth.sql");
    await encryptBackup(output, decryptedOutput, FLOWS_KEY, true);
    assert.equal(await readFile(decryptedOutput, "utf8"), sql);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
