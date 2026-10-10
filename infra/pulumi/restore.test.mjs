import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseRestoreArgs,
  validateManifest,
  buildD1ExecuteCommand,
  buildR2RestoreCommand,
} from "./restore.mjs";

const MANIFEST = {
  version: 1,
  stack: "preview",
  createdAt: "2026-10-10T00:00:00.000Z",
  pulumiOutputs: {
    documentsBucketName: "savia-documents-preview",
    databaseNames: {
      auth: "savia-auth-preview",
      domain: "savia-agencies-preview",
    },
  },
  d1: { auth: "/out/d1/auth.sql" },
  r2: null,
};

describe("pulumi restore", () => {
  it("requires --apply and --confirm-restore to execute", () => {
    const dry = parseRestoreArgs(["--manifest", "m.json", "--dry-run"]);
    assert.equal(dry.dryRun, true);
    assert.throws(() =>
      parseRestoreArgs(["--manifest", "m.json", "--apply"]),
    );
    const plan = parseRestoreArgs([
      "--manifest",
      "m.json",
      "--apply",
      "--confirm-restore",
      "preview",
    ]);
    assert.equal(plan.confirm, "preview");
  });

  it("refuses manifests for a different stack", () => {
    assert.equal(validateManifest(MANIFEST, "preview").stack, "preview");
    assert.throws(() => validateManifest(MANIFEST, "production"));
    assert.throws(() => validateManifest({ version: 2 }, "preview"));
    assert.throws(() =>
      validateManifest({ version: 1, d1: {} }, "preview"),
    );
  });

  it("builds D1 load and R2 sync-back commands", () => {
    const [command, args] = buildD1ExecuteCommand("savia-auth", "/out/a.sql");
    assert.equal(command, "pnpm");
    assert.ok(args.includes("execute"));
    assert.ok(args.includes("--remote"));
    assert.ok(args.includes("--file"));
    const [sync, syncArgs] = buildR2RestoreCommand({
      bucket: "savia-documents",
      sourceDir: "/out/r2",
      accountId: "abc123",
    });
    assert.equal(sync, "aws");
    assert.deepEqual(syncArgs.slice(0, 3), [
      "s3",
      "sync",
      "/out/r2",
    ]);
    assert.ok(syncArgs.includes("s3://savia-documents"));
  });
});
