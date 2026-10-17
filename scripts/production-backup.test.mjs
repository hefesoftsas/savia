import assert from "node:assert/strict";
import test from "node:test";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { hashBackupFiles, manifestFor } from "../infra/pulumi/backup.mjs";
import { RecoveryConsistencyError } from "../infra/pulumi/recovery-consistency.mjs";
import { r2InventoryHash } from "../infra/pulumi/recovery-consistency.mjs";
import { encryptBackup } from "./encrypt-flows-backup.mjs";
import { runProductionBackup as runWithGate } from "./production-backup.mjs";

const runProductionBackup = (options) =>
  runWithGate({ withGate: (capture) => capture(), ...options });

const KEY = "b".repeat(64);
const ACCOUNT_ID = "a".repeat(32);
const execFileAsync = promisify(execFile);

async function createValidCapture(
  plan,
  { missingAuth = false, missingDocumentsR2 = false } = {},
) {
  const outputs = {
    cloudflareAccountId: ACCOUNT_ID,
    authD1Id: "11111111-1111-4111-8111-111111111111",
    domainD1Id: "22222222-2222-4222-8222-222222222222",
    documentsBucketName: "savia-documents",
    resolvedEnvironment: "production",
    resolvedPublicOrigin: "https://savia.app.hefesoft.com",
    databaseNames: { auth: "savia-auth", domain: "savia-agencies" },
    flowsEnabled: false,
    flowsResources: null,
  };
  await mkdir(join(plan.outDir, "d1"), { recursive: true, mode: 0o700 });
  for (const name of Object.values(outputs.databaseNames)) {
    await writeFile(
      join(plan.outDir, "d1", `${name}.sql`),
      name === outputs.databaseNames.domain
        ? "CREATE TABLE retired_data (value TEXT);\nINSERT INTO retired_data VALUES ('source');\n"
        : "SELECT 1;\n",
    );
  }
  if (!missingDocumentsR2) {
    await mkdir(join(plan.outDir, "r2", "documents"), { recursive: true });
    await mkdir(join(plan.outDir, "r2-metadata"), { recursive: true });
    await writeFile(join(plan.outDir, "r2-metadata", "documents.json"), "{}\n");
  }
  const integrity = await hashBackupFiles(plan.outDir);
  const manifest = manifestFor({
    stack: "production",
    outputs,
    files: {
      "savia-auth": "d1/savia-auth.sql",
      "savia-agencies": "d1/savia-agencies.sql",
    },
    methods: { "savia-auth": "export", "savia-agencies": "schema-dump" },
    ...(missingAuth
      ? {
          files: { "savia-agencies": "d1/savia-agencies.sql" },
          methods: { "savia-agencies": "schema-dump" },
        }
      : {}),
    r2: missingDocumentsR2
      ? null
      : {
          bucket: "savia-documents",
          path: "r2/documents",
          metadataFile: "r2-metadata/documents.json",
          method: "object-get",
          objects: 0,
        },
    integrity,
    recoveryConsistency: {
      version: 1,
      accountId: ACCOUNT_ID,
      d1: {
        ...(!missingAuth
          ? {
              "savia-auth": {
                id: outputs.authD1Id,
                bookmark: "auth-bookmark",
              },
            }
          : {}),
        "savia-agencies": {
          id: outputs.domainD1Id,
          bookmark: "domain-bookmark",
        },
      },
      r2: missingDocumentsR2 ? {} : { "savia-documents": r2InventoryHash([]) },
    },
  });
  await writeFile(
    join(plan.outDir, "manifest.json"),
    `${JSON.stringify(manifest)}\n`,
  );
  return manifest;
}

test("retries only consistency drift in a fresh directory and retains only a verified encrypted artifact", async () => {
  const root = await mkdtemp(join(tmpdir(), "production-backup-runner-"));
  const artifactPath = join(root, "retained", "production-backup.enc");
  const summaryPath = join(root, "summary.md");
  const outputDirs = [];
  const delays = [];
  let calls = 0;
  try {
    const result = await runProductionBackup({
      artifactPath,
      workRoot: root,
      env: { SAVIA_BACKUP_KEY: KEY, CLOUDFLARE_ACCOUNT_ID: ACCOUNT_ID },
      summaryPath,
      sleep: async (delay) => delays.push(delay),
      captureBackup: async (plan) => {
        calls += 1;
        outputDirs.push(plan.outDir);
        if (calls === 1) {
          await mkdir(plan.outDir, { recursive: true });
          await writeFile(join(plan.outDir, "partial.sql"), "incomplete");
          throw new RecoveryConsistencyError("D1 changed during backup");
        }
        return createValidCapture(plan);
      },
    });
    assert.equal(result.attempts, 2);
    assert.deepEqual(delays, [60_000]);
    assert.notEqual(outputDirs[0], outputDirs[1]);
    assert.equal(
      (await readdir(root)).filter((name) =>
        name.startsWith("savia-production-backup-"),
      ).length,
      0,
    );
    const decrypted = join(root, "roundtrip.tar.gz");
    await encryptBackup(artifactPath, decrypted, KEY, true);
    assert.ok((await readFile(decrypted)).length > 0);
    const extracted = join(root, "extracted");
    await mkdir(extracted);
    await execFileAsync("tar", ["-xzf", decrypted, "-C", extracted]);
    assert.deepEqual(await readdir(extracted), ["production-backup"]);
    assert.ok(
      JSON.parse(
        await readFile(
          join(extracted, "production-backup", "manifest.json"),
          "utf8",
        ),
      ).recoveryConsistency,
    );
    assert.equal(
      await readFile(
        join(extracted, "production-backup", "d1", "savia-auth.sql"),
        "utf8",
      ),
      "SELECT 1;\n",
    );
    assert.match(
      await readFile(
        join(extracted, "production-backup", "d1", "savia-agencies.sql"),
        "utf8",
      ),
      /CREATE TABLE retired_data[\s\S]*INSERT INTO retired_data/,
    );
    const summary = await readFile(summaryPath, "utf8");
    assert.match(summary, /after 2 capture attempts/);
    assert.doesNotMatch(summary, /D1 changed during backup/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("permanent capture failures fail fast and remove incomplete plaintext", async () => {
  const root = await mkdtemp(join(tmpdir(), "production-backup-failure-"));
  const artifactPath = join(root, "production-backup.enc");
  let calls = 0;
  let sleeps = 0;
  try {
    await assert.rejects(
      runProductionBackup({
        artifactPath,
        workRoot: root,
        env: { SAVIA_BACKUP_KEY: KEY },
        captureBackup: async (plan) => {
          calls += 1;
          await mkdir(plan.outDir, { recursive: true });
          await writeFile(join(plan.outDir, "partial.sql"), "incomplete");
          throw new Error("configuration rejected");
        },
        sleep: async () => {
          sleeps += 1;
        },
      }),
      /configuration rejected/,
    );
    assert.equal(calls, 1);
    assert.equal(sleeps, 0);
    assert.deepEqual(await readdir(root), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("drift after the third capture fails without an artifact or leftover attempt files", async () => {
  const root = await mkdtemp(join(tmpdir(), "production-backup-exhausted-"));
  const delays = [];
  let calls = 0;
  try {
    await assert.rejects(
      runProductionBackup({
        artifactPath: join(root, "production-backup.enc"),
        workRoot: root,
        env: { SAVIA_BACKUP_KEY: KEY },
        sleep: async (delay) => delays.push(delay),
        captureBackup: async (plan) => {
          calls += 1;
          await mkdir(plan.outDir, { recursive: true });
          await writeFile(join(plan.outDir, "partial.sql"), "incomplete");
          throw new RecoveryConsistencyError("D1 changed during backup");
        },
      }),
      /D1 changed during backup/,
    );
    assert.equal(calls, 3);
    assert.deepEqual(delays, [60_000, 120_000]);
    assert.deepEqual(await readdir(root), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("refuses a successful-looking capture without committed manifest integrity", async () => {
  const root = await mkdtemp(join(tmpdir(), "production-backup-invalid-"));
  try {
    await assert.rejects(
      runProductionBackup({
        artifactPath: join(root, "production-backup.enc"),
        workRoot: root,
        env: { SAVIA_BACKUP_KEY: KEY },
        captureBackup: async (plan) => {
          await mkdir(plan.outDir, { recursive: true });
          await writeFile(join(plan.outDir, "manifest.json"), "{}\n");
          return { stack: "production" };
        },
      }),
      /Unsupported backup manifest version/,
    );
    assert.deepEqual(await readdir(root), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("refuses a capture missing one required D1 database before encryption", async () => {
  const root = await mkdtemp(join(tmpdir(), "production-backup-missing-d1-"));
  try {
    await assert.rejects(
      runProductionBackup({
        artifactPath: join(root, "production-backup.enc"),
        workRoot: root,
        env: { SAVIA_BACKUP_KEY: KEY, CLOUDFLARE_ACCOUNT_ID: ACCOUNT_ID },
        captureBackup: (plan) =>
          createValidCapture(plan, { missingAuth: true }),
      }),
      /every D1 database and method/,
    );
    assert.deepEqual(await readdir(root), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("refuses a D1-only capture before encryption", async () => {
  const root = await mkdtemp(join(tmpdir(), "production-backup-missing-r2-"));
  try {
    await assert.rejects(
      runProductionBackup({
        artifactPath: join(root, "production-backup.enc"),
        workRoot: root,
        env: { SAVIA_BACKUP_KEY: KEY, CLOUDFLARE_ACCOUNT_ID: ACCOUNT_ID },
        captureBackup: (plan) =>
          createValidCapture(plan, { missingDocumentsR2: true }),
      }),
      /missing the documents R2 backup/,
    );
    assert.deepEqual(await readdir(root), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("runner refuses capture when its write barrier cannot be acquired", async () => {
  const root = await mkdtemp(join(tmpdir(), "production-backup-gate-refusal-"));
  let captured = false;
  try {
    await assert.rejects(
      runWithGate({
        artifactPath: join(root, "backup.enc"),
        workRoot: root,
        env: { SAVIA_BACKUP_KEY: KEY, CLOUDFLARE_ACCOUNT_ID: ACCOUNT_ID },
        captureBackup: async () => {
          captured = true;
        },
      }),
      /SAVIA_BACKUP_CONTROL_SECRET/,
    );
    assert.equal(captured, false);
    assert.deepEqual(await readdir(root), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
