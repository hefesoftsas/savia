import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseBackupArgs,
  buildD1ExportCommand,
  buildR2SyncCommand,
  buildR2ObjectGetCommand,
  buildR2ObjectPutCommand,
  hasS3Credentials,
  manifestFor,
  listR2Objects,
  assertSafeTableDumpFallback,
  backupRelativePath,
} from "./backup.mjs";

describe("pulumi backup", () => {
  it("parses args and requires --apply to write", () => {
    assert.throws(() => parseBackupArgs(["--stack", "preview"]));
    const dry = parseBackupArgs(["--stack", "preview", "--dry-run"]);
    assert.equal(dry.stack, "preview");
    assert.equal(dry.skipR2, false);
    const skip = parseBackupArgs([
      "--stack",
      "production",
      "--apply",
      "--skip-r2",
    ]);
    assert.equal(skip.skipR2, true);
    assert.equal(
      parseBackupArgs([
        "--stack",
        "preview",
        "--apply",
        "--confirm-quiescent",
        "preview",
      ]).confirmQuiescent,
      "preview",
    );
  });

  it("rejects unknown stacks", () => {
    assert.throws(() => parseBackupArgs(["--stack", "qa", "--dry-run"]));
    assert.throws(() => parseBackupArgs(["--dry-run"]));
  });

  it("builds wrangler D1 export commands", () => {
    const [command, args] = buildD1ExportCommand("savia-auth", "/out/a.sql");
    assert.equal(command, "pnpm");
    assert.ok(args.includes("d1"));
    assert.ok(args.includes("export"));
    assert.ok(args.includes("savia-auth"));
    assert.ok(args.includes("--remote"));
    assert.ok(args.includes("/out/a.sql"));
  });

  it("builds R2 sync commands against the account endpoint", () => {
    const accountId = "08a0d36f8b0357684f83e4bfeb6628b6";
    const [command, args] = buildR2SyncCommand({
      bucket: "savia-documents",
      destDir: "/out/r2",
      accountId,
    });
    assert.equal(command, "aws");
    assert.deepEqual(args.slice(0, 3), ["s3", "sync", "s3://savia-documents"]);
    assert.equal(
      args[args.indexOf("--endpoint-url") + 1],
      `https://${accountId}.r2.cloudflarestorage.com`,
    );
    assert.throws(() =>
      buildR2SyncCommand({
        bucket: "savia-documents",
        destDir: "/out/r2",
        accountId: "not-hex",
      }),
    );
  });

  it("builds a restore-ready manifest", () => {
    const manifest = manifestFor({
      stack: "preview",
      outputs: { documentsBucketName: "b" },
      files: { "savia-auth-preview": "d1/a.sql" },
      r2: null,
    });
    assert.equal(manifest.version, 1);
    assert.equal(manifest.stack, "preview");
    assert.ok(manifest.createdAt);
  });

  it("requires explicit quiescence for fallback and disables it for production", () => {
    assert.throws(
      () => assertSafeTableDumpFallback("preview", null),
      /confirm-quiescent/,
    );
    assert.doesNotThrow(() =>
      assertSafeTableDumpFallback("preview", "preview"),
    );
    assert.throws(
      () => assertSafeTableDumpFallback("production", "production"),
      /production.*disabled/i,
    );
  });

  it("keeps manifest paths relative to the backup directory", () => {
    assert.equal(
      backupRelativePath("/backup/run", "/backup/run/d1/auth.sql"),
      "d1/auth.sql",
    );
    assert.throws(
      () => backupRelativePath("/backup/run", "/other/auth.sql"),
      /inside the backup/,
    );
  });

  it("fails closed when the paginated R2 API fails or truncation has no cursor", async () => {
    await assert.rejects(
      listR2Objects({
        bucket: "bucket",
        accountId: "08a0d36f8b0357684f83e4bfeb6628b6",
        token: "redacted",
        fetchImpl: async () => ({
          ok: true,
          status: 200,
          json: async () => ({
            success: false,
            errors: [{ message: "denied" }],
          }),
        }),
      }),
      /R2 list failed/,
    );
    await assert.rejects(
      listR2Objects({
        bucket: "bucket",
        accountId: "08a0d36f8b0357684f83e4bfeb6628b6",
        token: "redacted",
        fetchImpl: async () => ({
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            result: [],
            result_info: { is_truncated: true },
          }),
        }),
      }),
      /missing cursor/,
    );
  });

  it("retains all Cloudflare R2 object metadata from the API", async () => {
    const objects = await listR2Objects({
      bucket: "bucket",
      accountId: "08a0d36f8b0357684f83e4bfeb6628b6",
      token: "redacted",
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          result: [
            {
              key: "a.txt",
              size: 3,
              etag: "etag",
              last_modified: "2026-10-12T00:00:00Z",
              ssec: false,
              storage_class: "Standard",
              http_metadata: {
                contentType: "text/plain",
                cacheControl: "no-cache",
              },
              custom_metadata: { owner: "savia" },
            },
          ],
          result_info: { is_truncated: false },
        }),
      }),
    });
    assert.deepEqual(objects[0], {
      key: "a.txt",
      size: 3,
      etag: "etag",
      lastModified: "2026-10-12T00:00:00Z",
      ssec: false,
      storageClass: "Standard",
      httpMetadata: { contentType: "text/plain", cacheControl: "no-cache" },
      customMetadata: { owner: "savia" },
    });
  });

  it("follows every R2 cursor and rejects a repeated pagination cursor", async () => {
    const urls = [];
    const objects = await listR2Objects({
      bucket: "bucket",
      accountId: "08a0d36f8b0357684f83e4bfeb6628b6",
      token: "redacted",
      fetchImpl: async (url) => {
        urls.push(url);
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            result: [{ key: `page-${urls.length}` }],
            result_info:
              urls.length === 1
                ? { is_truncated: true, cursor: "next" }
                : { is_truncated: false },
          }),
        };
      },
    });
    assert.deepEqual(
      objects.map(({ key }) => key),
      ["page-1", "page-2"],
    );
    assert.match(urls[1], /cursor=next/);

    await assert.rejects(
      listR2Objects({
        bucket: "bucket",
        accountId: "08a0d36f8b0357684f83e4bfeb6628b6",
        token: "redacted",
        fetchImpl: async () => ({
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            result: [],
            result_info: { is_truncated: true, cursor: "same" },
          }),
        }),
      }),
      /repeated a pagination cursor/,
    );
  });

  it("builds per-object R2 get/put commands", () => {
    const [get, getArgs] = buildR2ObjectGetCommand({
      bucket: "b",
      key: "a/c.txt",
      destFile: "/out/a/c.txt",
    });
    assert.equal(get, "pnpm");
    assert.ok(getArgs.includes("get"));
    assert.ok(getArgs.includes("b/a/c.txt"));
    assert.ok(getArgs.includes("--remote"));
    assert.ok(getArgs.includes("/out/a/c.txt"));
    const [, putArgs] = buildR2ObjectPutCommand({
      bucket: "b",
      key: "a/c.txt",
      sourceFile: "/out/a/c.txt",
      httpMetadata: { contentType: "text/plain", cacheControl: "max-age=30" },
    });
    assert.ok(putArgs.includes("put"));
    assert.ok(putArgs.includes("b/a/c.txt"));
    assert.deepEqual(
      putArgs.slice(
        putArgs.indexOf("--content-type"),
        putArgs.indexOf("--content-type") + 2,
      ),
      ["--content-type", "text/plain"],
    );
    assert.ok(putArgs.includes("--cache-control"));
    const [, legacyPutArgs] = buildR2ObjectPutCommand({
      bucket: "b",
      key: "a/c.txt",
      sourceFile: "/out/a/c.txt",
      contentType: "text/plain",
      contentEncoding: "gzip",
    });
    assert.ok(legacyPutArgs.includes("--content-type"));
    assert.ok(legacyPutArgs.includes("--content-encoding"));
    assert.equal(
      buildR2ObjectPutCommand({
        bucket: "b",
        key: "a/c.txt",
        sourceFile: "/out/a/c.txt",
        accountId: "08a0d36f8b0357684f83e4bfeb6628b6",
        s3Credentials: true,
        customMetadata: { owner: "savia" },
        storageClass: "InfrequentAccess",
      })[0],
      "aws",
    );
    const [, s3PutArgs] = buildR2ObjectPutCommand({
      bucket: "b",
      key: "a/c.txt",
      sourceFile: "/out/a/c.txt",
      accountId: "08a0d36f8b0357684f83e4bfeb6628b6",
      s3Credentials: true,
      customMetadata: { owner: "savia" },
      storageClass: "InfrequentAccess",
    });
    assert.deepEqual(
      s3PutArgs.slice(
        s3PutArgs.indexOf("--storage-class"),
        s3PutArgs.indexOf("--storage-class") + 2,
      ),
      ["--storage-class", "STANDARD_IA"],
    );
    assert.throws(
      () =>
        buildR2ObjectPutCommand({
          bucket: "b",
          key: "a/c.txt",
          sourceFile: "/out/a/c.txt",
          customMetadata: { owner: "savia" },
          s3Credentials: false,
        }),
      /custom R2 metadata requires/,
    );
    assert.throws(() =>
      buildR2ObjectGetCommand({ bucket: "b", key: "", destFile: "/o" }),
    );
    assert.throws(() =>
      buildR2ObjectGetCommand({
        bucket: "b",
        key: "a/../../x",
        destFile: "/o",
      }),
    );
  });

  it("detects S3 credentials from env", () => {
    assert.equal(
      hasS3Credentials({ AWS_ACCESS_KEY_ID: "id", AWS_SECRET_ACCESS_KEY: "s" }),
      true,
    );
    assert.equal(hasS3Credentials({}), false);
    assert.equal(hasS3Credentials({ AWS_ACCESS_KEY_ID: "id" }), false);
  });
});
