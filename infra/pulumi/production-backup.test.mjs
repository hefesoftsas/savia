import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, writeFile, access, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createBackup,
  parseBackupArgs,
  commitBackupManifest,
} from "./backup.mjs";
import { resolveInfraNames } from "./naming.mjs";
import { validateManifest, verifyManifestIntegrity } from "./restore.mjs";

async function fixture(databaseNames = {}, domainDatabase = null) {
  const root = await mkdtemp(join(tmpdir(), "production-backup-"));
  const outDir = join(root, "capture");
  const accountId = "a".repeat(32);
  const names = resolveInfraNames({
    environment: "production",
    ...databaseNames,
    documentsBucket: "savia-documents",
    publicOrigin: "https://savia.app.hefesoft.com",
  });
  const outputs = {
    cloudflareAccountId: accountId,
    authD1Id: "11111111-1111-4111-8111-111111111111",
    domainD1Id: "22222222-2222-4222-8222-222222222222",
    documentsBucketName: names.bucket,
    resolvedEnvironment: "production",
    resolvedPublicOrigin: names.publicOrigin,
    workerNames: names.workers,
    databaseNames: names.databases,
    plannedFlowsResourceNames: names.flows,
    flowsEnabled: false,
    flowsExecutionEnabled: false,
    flowsResources: null,
    deletionProtected: true,
  };
  const state = {
    changed: false,
    captured: false,
    r2Changed: false,
    fts: false,
    calls: [],
  };
  const options = {
    env: {
      CLOUDFLARE_ACCOUNT_ID: accountId,
      CLOUDFLARE_API_TOKEN: "redacted",
      SAVIA_BACKUP_R2_FORCE_API: "true",
    },
    run: async (command, args) => {
      state.calls.push([command, args]);
      if (command === "pulumi") return { stdout: JSON.stringify(outputs) };
      assert.equal(command, "pnpm");
      assert.ok(args.includes("export"));
      if (state.fts && args.includes(outputs.databaseNames.domain))
        throw new Error("cannot export virtual tables like FTS5");
      await writeFile(args[args.indexOf("--output") + 1], "SELECT 1;\n");
      return { stdout: "" };
    },
    fetchImpl: async (url, options) => {
      if (url.includes("/objects?"))
        return {
          ok: true,
          json: async () => ({
            success: true,
            result: [
              {
                key: "proposal.docx",
                size: 4,
                etag:
                  state.captured && state.r2Changed ? "changed" : "original",
              },
            ],
          }),
        };
      const id = url.split("/database/")[1].split("/")[0];
      const result = url.endsWith("/bookmark")
        ? {
            bookmark:
              state.changed && state.captured ? "after-write" : "stable",
          }
        : url.endsWith("/query")
          ? [
              {
                success: true,
                results: domainDatabase
                  ? domainDatabase
                      .prepare(JSON.parse(options.body).sql)
                      .all()
                      .map((row) =>
                        Object.fromEntries(
                          Object.entries(row).map(([key, value]) => [
                            key,
                            value instanceof Uint8Array ? [...value] : value,
                          ]),
                        ),
                      )
                  : [],
              },
            ]
          : {
              uuid: id,
              name:
                id === outputs.authD1Id
                  ? outputs.databaseNames.auth
                  : outputs.databaseNames.domain,
            };
      return { ok: true, json: async () => ({ success: true, result }) };
    },
    downloadImpl: async ({ destFile }) => {
      await writeFile(destFile, "data");
      state.captured = true;
    },
  };
  const plan = parseBackupArgs([
    "--stack",
    "production",
    "--apply",
    "--out-dir",
    outDir,
  ]);
  return { root, outDir, outputs, state, options, plan };
}

test("production capture writes a restore-ready verified archive with exact adopted targets", async () => {
  const f = await fixture();
  try {
    f.state.fts = true;
    delete f.options.env.SAVIA_BACKUP_R2_FORCE_API;
    f.options.env.AWS_ACCESS_KEY_ID = "state-backend-only";
    f.options.env.AWS_SECRET_ACCESS_KEY = "state-backend-only";
    const manifest = await createBackup(f.plan, f.options);
    assert.equal(manifest.d1Methods["savia-agencies"], "schema-dump");
    assert.equal(
      manifest.recoveryConsistency.d1["savia-agencies"].id,
      f.outputs.domainD1Id,
    );
    validateManifest(manifest);
    const missingProof = structuredClone(manifest);
    delete missingProof.recoveryConsistency;
    assert.throws(() => validateManifest(missingProof), /consistency proof/);
    const wrongProof = structuredClone(manifest);
    wrongProof.recoveryConsistency.d1["savia-agencies"].id = f.outputs.authD1Id;
    assert.throws(() => validateManifest(wrongProof), /consistency proof/);
    const missingR2 = structuredClone(manifest);
    delete missingR2.recoveryConsistency.r2;
    assert.throws(() => validateManifest(missingR2), /consistency proof/);
    const wrongR2 = structuredClone(manifest);
    wrongR2.recoveryConsistency.r2["savia-documents"] = "f".repeat(64);
    await assert.rejects(
      verifyManifestIntegrity(wrongR2, join(f.outDir, "manifest.json")),
      /inventory.*proof/,
    );
    await verifyManifestIntegrity(manifest, join(f.outDir, "manifest.json"));
    assert.deepEqual(
      JSON.parse(await readFile(join(f.outDir, "manifest.json"))),
      manifest,
    );
    assert.ok(
      f.state.calls.every(
        ([command, args]) => command !== "pulumi" || args[0] === "stack",
      ),
    );
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("adopted production database names survive capture and restore validation", async () => {
  const f = await fixture({
    authDatabaseName: "savia-auth-local-canonical-20260913-v2",
    domainDatabaseName: "savia-agencies-local-canonical-20260913-v2",
  });
  try {
    f.state.fts = true;
    const manifest = await createBackup(f.plan, f.options);
    assert.equal(
      manifest.d1Methods[f.outputs.databaseNames.domain],
      "schema-dump",
    );
    assert.deepEqual(
      Object.keys(manifest.recoveryConsistency.d1).sort(),
      Object.values(f.outputs.databaseNames).sort(),
    );
    validateManifest(manifest);
    await verifyManifestIntegrity(manifest, join(f.outDir, "manifest.json"));
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("a D1 or R2 write during capture never produces a successful manifest", async () => {
  for (const field of ["changed", "r2Changed"]) {
    const f = await fixture();
    try {
      f.state[field] = true;
      await assert.rejects(
        createBackup(f.plan, f.options),
        /changed during backup/,
      );
      await assert.rejects(access(join(f.outDir, "manifest.json")));
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  }
});

test("refuses reused backup directories and mismatched stack outputs", async () => {
  const f = await fixture();
  try {
    await createBackup(f.plan, f.options);
    await assert.rejects(createBackup(f.plan, f.options), /EEXIST/);
    await assert.rejects(
      createBackup({ ...f.plan, stack: "preview" }, f.options),
      /stack.*disagree/,
    );
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("a failed final manifest publication leaves neither a success path nor a temporary manifest", async () => {
  const root = await mkdtemp(join(tmpdir(), "manifest-commit-"));
  try {
    await assert.rejects(
      commitBackupManifest(
        root,
        { version: 2 },
        {
          renameFile: async () => {
            throw new Error("disk failure");
          },
        },
      ),
      /disk failure/,
    );
    await assert.rejects(access(join(root, "manifest.json")));
    await assert.rejects(access(join(root, "manifest.json.tmp")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("production FTS fallback keeps source schemas, archived row duplicates and historical IDs", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const source = new DatabaseSync(":memory:");
  const restored = new DatabaseSync(":memory:");
  source.exec(`
    CREATE TABLE access_roles (id TEXT PRIMARY KEY, scope TEXT, name TEXT, UNIQUE(scope,name));
    INSERT INTO access_roles VALUES ('historical-id','system','owner');
    CREATE TABLE _savia_retired_20260930_agencies(id INTEGER, data BLOB, note TEXT);
    INSERT INTO _savia_retired_20260930_agencies VALUES (1,X'00FF',NULL),(1,X'00FF',NULL);
    CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT);
    INSERT INTO d1_migrations VALUES (40,'original-history.sql');
    DELETE FROM d1_migrations;
    INSERT INTO d1_migrations(name) VALUES ('latest-history.sql');
    UPDATE sqlite_sequence SET seq=99 WHERE name='d1_migrations';
    CREATE TABLE documents(id INTEGER PRIMARY KEY,title TEXT);
    INSERT INTO documents VALUES(1,'Preserved archive');
    CREATE VIRTUAL TABLE documents_fts USING fts5(title,content='documents',content_rowid='id');
    INSERT INTO documents_fts(documents_fts) VALUES('rebuild');
  `);
  const f = await fixture({}, source);
  f.state.fts = true;
  try {
    const manifest = await createBackup(f.plan, f.options);
    assert.equal(
      manifest.d1Methods[f.outputs.databaseNames.domain],
      "schema-dump",
    );
    validateManifest(manifest);
    await verifyManifestIntegrity(manifest, join(f.outDir, "manifest.json"));
    const sql = await readFile(
      join(f.outDir, manifest.d1[f.outputs.databaseNames.domain]),
      "utf8",
    );
    restored.exec("BEGIN;" + sql + "COMMIT;");
    assert.deepEqual(
      restored.prepare("SELECT * FROM access_roles").all(),
      source.prepare("SELECT * FROM access_roles").all(),
    );
    assert.deepEqual(
      restored.prepare("SELECT * FROM _savia_retired_20260930_agencies").all(),
      source.prepare("SELECT * FROM _savia_retired_20260930_agencies").all(),
    );
    assert.deepEqual(
      restored.prepare("SELECT * FROM d1_migrations").all(),
      source.prepare("SELECT * FROM d1_migrations").all(),
    );
    assert.deepEqual(
      restored.prepare("SELECT * FROM sqlite_sequence").all(),
      source.prepare("SELECT * FROM sqlite_sequence").all(),
    );
    assert.equal(
      restored
        .prepare(
          "SELECT count(*) AS n FROM documents_fts WHERE documents_fts MATCH 'Preserved'",
        )
        .get().n,
      1,
    );
    assert.equal(
      restored.prepare("PRAGMA integrity_check").get().integrity_check,
      "ok",
    );
    assert.deepEqual(restored.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    source.close();
    restored.close();
    await rm(f.root, { recursive: true, force: true });
  }
});
