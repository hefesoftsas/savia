import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseRestoreArgs,
  validateManifest,
  buildD1ExecuteCommand,
  buildR2RestoreCommand,
  listLocalFiles,
  needsMigrations,
  readSidecar,
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
      accountId: "08a0d36f8b0357684f83e4bfeb6628b6",
    });
    assert.equal(sync, "aws");
    assert.deepEqual(syncArgs.slice(0, 3), [
      "s3",
      "sync",
      "/out/r2",
    ]);
    assert.ok(syncArgs.includes("s3://savia-documents"));
  });

  it("lists local backup files as object keys", async () => {
    const base = await mkdtemp(join(tmpdir(), "r2-restore-"));
    await mkdir(join(base, "a", "b"), { recursive: true });
    await writeFile(join(base, "a", "b", "c.txt"), "x");
    await writeFile(join(base, "root.txt"), "y");
    assert.deepEqual(await listLocalFiles(base), ["a/b/c.txt", "root.txt"]);
  });

  it("detects table dumps needing migrations first", () => {
    assert.equal(
      needsMigrations({ d1Methods: { a: "export", b: "table-dump" } }),
      true,
    );
    assert.equal(needsMigrations({ d1Methods: { a: "export" } }), false);
    assert.equal(needsMigrations({}), false);
    assert.equal(needsMigrations(null), false);
  });

  it("reads the metadata sidecar tolerantly", async () => {
    const base = await mkdtemp(join(tmpdir(), "r2-sidecar-"));
    const file = join(base, "r2-metadata.json");
    await writeFile(file, JSON.stringify({ "a.txt": { customMetadata: { t: "1" } } }));
    assert.deepEqual(await readSidecar(file), {
      "a.txt": { customMetadata: { t: "1" } },
    });
    assert.deepEqual(await readSidecar(join(base, "missing.json")), {});
    assert.deepEqual(await readSidecar(null), {});
  });
});
