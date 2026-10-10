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

  it("builds a restore-ready manifest", () => {    const manifest = manifestFor({
      stack: "preview",
      outputs: { documentsBucketName: "b" },
      files: { "savia-auth-preview": "/out/d1/a.sql" },
      r2: null,
    });
    assert.equal(manifest.version, 1);
    assert.equal(manifest.stack, "preview");
    assert.ok(manifest.createdAt);
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
      contentType: "text/plain",
    });
    assert.ok(putArgs.includes("put"));
    assert.ok(putArgs.includes("b/a/c.txt"));
    assert.deepEqual(
      putArgs.slice(putArgs.indexOf("--content-type"), putArgs.indexOf("--content-type") + 2),
      ["--content-type", "text/plain"],
    );
    assert.throws(() =>
      buildR2ObjectGetCommand({ bucket: "b", key: "", destFile: "/o" }),
    );
    assert.throws(() =>
      buildR2ObjectGetCommand({ bucket: "b", key: "a/../../x", destFile: "/o" }),
    );
  });

  it("detects S3 credentials from env", () => {
    assert.equal(
      hasS3Credentials({ AWS_ACCESS_KEY_ID: "id", AWS_SECRET_ACCESS_KEY: "s" }),
      true,
    );
    assert.equal(hasS3Credentials({}), false);
    assert.equal(
      hasS3Credentials({ AWS_ACCESS_KEY_ID: "id" }),
      false,
    );
  });
});
