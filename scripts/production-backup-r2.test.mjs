import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { uploadProductionBackup } from "./production-backup-r2.mjs";

const MAGIC = Buffer.from("SAVIAFB1");
const CREDENTIALS = {
  R2_BACKUP_ACCESS_KEY_ID: "dedicated-access-key",
  R2_BACKUP_SECRET_ACCESS_KEY: "dedicated-secret-key",
  CLOUDFLARE_ACCOUNT_ID: "a".repeat(32),
  SAVIA_BACKUP_BUCKET: "savia-production-backups",
  SAVIA_BACKUP_ENVIRONMENT: "production",
  GITHUB_RUN_ID: "9123",
  GITHUB_RUN_ATTEMPT: "2",
  GITHUB_SHA: "c".repeat(40),
  PATH: "/usr/bin",
  AWS_PROFILE: "must-not-be-inherited",
  AWS_ACCESS_KEY_ID: "wrong-state-key",
  AWS_SECRET_ACCESS_KEY: "wrong-state-secret",
  SAVIA_BACKUP_CONTROL_SECRET: "must-not-be-inherited",
};
const execFileAsync = promisify(execFile);

function awsValue(args, name) {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
}

function makeR2({
  mismatchReadback = false,
  failPut = false,
  providerText = "",
} = {}) {
  const objects = new Map();
  const calls = [];
  const downloadPaths = [];
  const execFileImpl = async (file, args, options) => {
    calls.push({ file, args: [...args], options });
    assert.equal(file, "aws");
    assert.equal(args[0], "s3api");
    const env = options.env;
    assert.equal(env.AWS_PAGER, "");
    assert.equal(env.AWS_ACCESS_KEY_ID, CREDENTIALS.R2_BACKUP_ACCESS_KEY_ID);
    assert.equal(
      env.AWS_SECRET_ACCESS_KEY,
      CREDENTIALS.R2_BACKUP_SECRET_ACCESS_KEY,
    );
    assert.equal(env.AWS_DEFAULT_REGION, "auto");
    assert.equal(env.AWS_PROFILE, undefined);
    assert.equal(env.AWS_CONFIG_FILE, "/dev/null");
    assert.equal(env.AWS_SHARED_CREDENTIALS_FILE, "/dev/null");
    assert.equal(env.SAVIA_BACKUP_CONTROL_SECRET, undefined);
    assert.ok(args.includes("--endpoint-url"));
    assert.equal(
      awsValue(args, "--endpoint-url"),
      `https://${CREDENTIALS.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    );
    const operation = args[1];
    const bucket = awsValue(args, "--bucket");
    const key = awsValue(args, "--key");
    assert.equal(bucket, "savia-production-backups");
    if (operation === "put-object") {
      if (failPut) throw new Error(providerText || "provider failure");
      if (objects.has(key)) throw new Error("PreconditionFailed");
      const body = await readFile(awsValue(args, "--body"));
      objects.set(key, {
        body,
        metadata: JSON.parse(awsValue(args, "--metadata")),
        lastModified: key.endsWith(".enc")
          ? "2026-10-17T11:59:59.000Z"
          : "2026-10-17T12:00:00.000Z",
      });
      return { stdout: JSON.stringify({ ETag: '"test-etag"' }), stderr: "" };
    }
    if (operation === "head-object") {
      const object = objects.get(key);
      if (!object) throw new Error("NoSuchKey");
      return {
        stdout: JSON.stringify({
          ContentLength: object.body.length,
          Metadata: object.metadata,
          LastModified: object.lastModified,
        }),
        stderr: "",
      };
    }
    if (operation === "get-object") {
      const object = objects.get(key);
      if (!object) throw new Error("NoSuchKey");
      downloadPaths.push(args[6]);
      const body =
        mismatchReadback && key.endsWith(".enc")
          ? Buffer.concat([object.body, Buffer.from("tampered")])
          : object.body;
      await writeFile(args[6], body, { mode: 0o600 });
      return { stdout: "{}", stderr: "" };
    }
    throw new Error(`unexpected AWS operation: ${operation}`);
  };
  return { objects, calls, downloadPaths, execFileImpl };
}

async function withArtifact(
  callback,
  bytes = Buffer.concat([MAGIC, Buffer.alloc(64, 0x5a)]),
) {
  const root = await mkdtemp(join(tmpdir(), "production-backup-r2-test-"));
  const artifact = join(root, "backup.enc");
  await writeFile(artifact, bytes, { mode: 0o600 });
  try {
    return await callback({ root, artifact });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("uploads ciphertext, verifies exact readback, then publishes a commit marker", async () => {
  await withArtifact(async ({ root, artifact }) => {
    const r2 = makeR2();
    const result = await uploadProductionBackup({
      artifactPath: artifact,
      env: CREDENTIALS,
      execFileImpl: r2.execFileImpl,
    });
    const key = "production/daily-9123-2.enc";
    const markerKey = `${key}.commit.json`;
    assert.equal(result.key, key);
    assert.equal(result.markerKey, markerKey);
    assert.equal(result.verified, true);
    assert.equal(r2.objects.size, 2);
    const uploaded = r2.objects.get(key);
    assert.deepEqual(uploaded.body, await readFile(artifact));
    assert.deepEqual(uploaded.metadata, {
      sha256: createHash("sha256")
        .update(await readFile(artifact))
        .digest("hex"),
      "source-sha": CREDENTIALS.GITHUB_SHA,
      environment: "production",
      "run-id": "9123",
      "run-attempt": "2",
      kind: "daily",
      verified: "true",
    });
    const marker = JSON.parse(r2.objects.get(markerKey).body.toString("utf8"));
    assert.equal(marker.objectKey, key);
    assert.equal(marker.sha256, uploaded.metadata.sha256);
    assert.equal(marker.sizeBytes, uploaded.body.length);
    assert.equal(marker.kind, "daily");
    assert.equal(marker.createdAt, uploaded.lastModified);
    const puts = r2.calls.filter(({ args }) => args[1] === "put-object");
    assert.equal(puts.length, 2);
    assert.ok(
      puts.every(
        ({ args }) =>
          args.includes("--if-none-match") &&
          awsValue(args, "--if-none-match") === "*",
      ),
    );
    assert.ok(puts.every(({ args }) => args.includes("--endpoint-url")));
    assert.deepEqual(await readdir(root), ["backup.enc"]);
    for (const path of r2.downloadPaths)
      await assert.rejects(readFile(path), { code: "ENOENT" });
  });
});

test("uses the caller's explicitly selected release or migration kind", async () => {
  await withArtifact(async ({ artifact }) => {
    for (const kind of ["release", "migration"]) {
      const r2 = makeR2();
      const result = await uploadProductionBackup({
        artifactPath: artifact,
        kind,
        env: CREDENTIALS,
        execFileImpl: r2.execFileImpl,
      });
      assert.equal(result.key, `production/${kind}-9123-2.enc`);
    }
  });
});

test("rejects a non-SAVIAFB1 payload before contacting R2", async () => {
  await withArtifact(async ({ artifact }) => {
    const r2 = makeR2();
    await assert.rejects(
      uploadProductionBackup({
        artifactPath: artifact,
        env: CREDENTIALS,
        execFileImpl: r2.execFileImpl,
      }),
      /not a SAVIA encrypted backup/,
    );
    assert.equal(r2.calls.length, 0);
  }, Buffer.from("plain text payload that is intentionally unencrypted"));
});

test("a mismatched readback never publishes a commit marker and cleans temporary files", async () => {
  await withArtifact(async ({ root, artifact }) => {
    const r2 = makeR2({ mismatchReadback: true });
    await assert.rejects(
      uploadProductionBackup({
        artifactPath: artifact,
        env: CREDENTIALS,
        execFileImpl: r2.execFileImpl,
      }),
      /R2 readback verification failed/,
    );
    assert.equal(
      r2.objects.has("production/daily-9123-2.enc.commit.json"),
      false,
    );
    assert.deepEqual(await readdir(root), ["backup.enc"]);
    for (const path of r2.downloadPaths)
      await assert.rejects(readFile(path), { code: "ENOENT" });
  });
});

test("a retry accepts only the exact already-stored ciphertext and marker", async () => {
  await withArtifact(async ({ artifact }) => {
    const r2 = makeR2();
    const options = {
      artifactPath: artifact,
      env: CREDENTIALS,
      execFileImpl: r2.execFileImpl,
    };
    const first = await uploadProductionBackup(options);
    const second = await uploadProductionBackup(options);
    assert.deepEqual(second, first);
    assert.equal(r2.objects.size, 2);
    assert.equal(
      r2.calls.filter(({ args }) => args[1] === "put-object").length,
      4,
    );
    for (const path of r2.downloadPaths)
      await assert.rejects(readFile(path), { code: "ENOENT" });
  });
});

test("AWS CLI s3api model accepts the upload and verification arguments offline", async (t) => {
  const env = {
    PATH: process.env.PATH,
    AWS_PAGER: "",
    AWS_CONFIG_FILE: "/dev/null",
    AWS_SHARED_CREDENTIALS_FILE: "/dev/null",
    AWS_EC2_METADATA_DISABLED: "true",
  };
  try {
    await execFileAsync("aws", ["--version"], { env });
  } catch {
    t.skip("AWS CLI is not installed in this environment");
    return;
  }

  await withArtifact(async ({ artifact }) => {
    const body = artifact;
    const shared = [
      "--bucket",
      "savia-production-backups",
      "--key",
      "production/daily-9123-2.enc",
    ];
    const commands = [
      [
        "s3api",
        "put-object",
        "--generate-cli-skeleton",
        "input",
        ...shared,
        "--body",
        body,
        "--content-type",
        "application/octet-stream",
        "--if-none-match",
        "*",
        "--metadata",
        '{"sha256":"' + "a".repeat(64) + '"}',
      ],
      ["s3api", "head-object", "--generate-cli-skeleton", "input", ...shared],
      [
        "s3api",
        "list-objects-v2",
        "--generate-cli-skeleton",
        "input",
        "--bucket",
        "savia-production-backups",
        "--prefix",
        "production/daily-",
        "--max-keys",
        "1000",
        "--no-paginate",
        "--continuation-token",
        "offline-token",
      ],
    ];
    for (const args of commands) {
      const { stdout } = await execFileAsync("aws", args, {
        env,
        maxBuffer: 1024 * 1024,
      });
      assert.ok(
        stdout.length > 0,
        `${args[0]} ${args[1]} returned no input skeleton`,
      );
    }
  });
});

test("fails closed when the bucket, environment, or artifact path is not explicit", async () => {
  await withArtifact(async ({ artifact }) => {
    const r2 = makeR2();
    await assert.rejects(
      uploadProductionBackup({
        artifactPath: artifact,
        env: { ...CREDENTIALS, SAVIA_BACKUP_BUCKET: "other" },
        execFileImpl: r2.execFileImpl,
      }),
      /production backup bucket/,
    );
    await assert.rejects(
      uploadProductionBackup({
        artifactPath: artifact,
        env: { ...CREDENTIALS, SAVIA_BACKUP_ENVIRONMENT: "preview" },
        execFileImpl: r2.execFileImpl,
      }),
      /explicit production environment/,
    );
    await assert.rejects(
      uploadProductionBackup({
        artifactPath: "relative.enc",
        env: CREDENTIALS,
        execFileImpl: r2.execFileImpl,
      }),
      /absolute path/,
    );
    assert.equal(r2.calls.length, 0);
  });
});

test("does not expose provider error details", async () => {
  await withArtifact(async ({ artifact }) => {
    const r2 = makeR2({
      failPut: true,
      providerText: "secret provider response payload",
    });
    await assert.rejects(
      uploadProductionBackup({
        artifactPath: artifact,
        env: CREDENTIALS,
        execFileImpl: r2.execFileImpl,
      }),
      (error) => {
        assert.match(error.message, /R2/);
        assert.doesNotMatch(error.message, /secret provider response/);
        return true;
      },
    );
  });
});
