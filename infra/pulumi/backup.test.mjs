import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseBackupArgs,
  buildD1ExportCommand,
  buildR2SyncCommand,
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
    const [command, args] = buildR2SyncCommand({
      bucket: "savia-documents",
      destDir: "/out/r2",
      accountId: "abc123",
    });
    assert.equal(command, "aws");
    assert.deepEqual(args.slice(0, 3), ["s3", "sync", "s3://savia-documents"]);
    assert.ok(
      args.includes("https://abc123.r2.cloudflarestorage.com"),
    );
  });

  it("builds a restore-ready manifest", () => {
    const manifest = manifestFor({
      stack: "preview",
      outputs: { documentsBucketName: "b" },
      files: { "savia-auth-preview": "/out/d1/a.sql" },
      r2: null,
    });
    assert.equal(manifest.version, 1);
    assert.equal(manifest.stack, "preview");
    assert.ok(manifest.createdAt);
  });
});
