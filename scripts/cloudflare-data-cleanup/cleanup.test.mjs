import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import { runCleanup } from "./cleanup.mjs";

function d1() {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE extension_action_runs (
      tenant_id TEXT NOT NULL, run_id TEXT NOT NULL, status TEXT NOT NULL,
      input TEXT NOT NULL, output TEXT, updated_at TEXT NOT NULL,
      PRIMARY KEY (tenant_id, run_id)
    );
    CREATE TABLE studio_extension_installations (
      tenant_id TEXT NOT NULL, id TEXT NOT NULL, version TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (tenant_id, id)
    );
    CREATE TABLE plugin_store_artifacts (
      tenant_id TEXT NOT NULL, id TEXT NOT NULL, version TEXT NOT NULL,
      PRIMARY KEY (tenant_id, id, version)
    );
    CREATE TABLE plugin_store_sources (
      tenant_id TEXT NOT NULL, id TEXT NOT NULL, version TEXT NOT NULL,
      files TEXT NOT NULL, PRIMARY KEY (tenant_id, id, version),
      FOREIGN KEY (tenant_id, id, version)
        REFERENCES plugin_store_artifacts(tenant_id, id, version) ON DELETE CASCADE
    );
    CREATE TABLE dossier_records (
      owner_id TEXT NOT NULL, kind TEXT NOT NULL, id TEXT NOT NULL,
      revision INTEGER NOT NULL, value TEXT NOT NULL, updated_at INTEGER NOT NULL,
      PRIMARY KEY (owner_id, kind, id)
    );
  `);
  database.exec("PRAGMA foreign_keys=ON");
  return {
    database,
    prepare(sql) {
      return {
        bind(...args) {
          return {
            all: async () => {
              const result = database.prepare(sql).all(...args);
              return { results: result };
            },
            first: async () => database.prepare(sql).get(...args) ?? null,
            run: () => {
              const result = database.prepare(sql).run(...args);
              return { meta: { changes: Number(result.changes) } };
            },
          };
        },
        all: async () => ({ results: database.prepare(sql).all() }),
        first: async () => database.prepare(sql).get() ?? null,
        run: () => {
          const result = database.prepare(sql).run();
          return { meta: { changes: Number(result.changes) } };
        },
      };
    },
    async batch(statements) {
      database.exec("BEGIN");
      try {
        const results = statements.map((statement) => {
          const result = statement.run();
          return { meta: { changes: Number(result.meta.changes) } };
        });
        database.exec("COMMIT");
        return results;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

function insert(db, sql, ...values) {
  db.database.prepare(sql).run(...values);
}

function versions(db, tenantId, pluginId) {
  return db.database
    .prepare(
      "SELECT version FROM plugin_store_artifacts WHERE tenant_id=? AND id=? ORDER BY version",
    )
    .all(tenantId, pluginId)
    .map((row) => row.version);
}

test("daily cleanup prunes only old terminal action runs and keeps pending/recent runs", async () => {
  const db = d1();
  const now = Date.parse("2026-10-24T12:00:00.000Z");
  insert(
    db,
    "INSERT INTO extension_action_runs VALUES(?,?,?,?,?,?)",
    "tenant-a",
    "old-success",
    "succeeded",
    "{}",
    '{"large":true}',
    "2026-10-22T11:59:59.999Z",
  );
  insert(
    db,
    "INSERT INTO extension_action_runs VALUES(?,?,?,?,?,?)",
    "tenant-a",
    "recent-failure",
    "failed",
    "{}",
    "{}",
    "2026-10-23T12:00:00.001Z",
  );
  insert(
    db,
    "INSERT INTO extension_action_runs VALUES(?,?,?,?,?,?)",
    "tenant-a",
    "pending",
    "pending",
    "{}",
    null,
    "2026-10-20T00:00:00.000Z",
  );
  const result = await runCleanup(
    { agencyProduction: db },
    { now, maxBatches: 5 },
  );
  assert.equal(result.targets.agencyProduction.extensionRuns.deleted, 1);
  assert.deepEqual(
    db.database
      .prepare("SELECT run_id FROM extension_action_runs ORDER BY run_id")
      .all()
      .map((row) => row.run_id),
    ["pending", "recent-failure"],
  );
});

test("plugin cleanup preserves every installed version and the newest semantic version per tenant", async () => {
  const db = d1();
  for (const [version, enabled] of [
    ["1.9.0", 0],
    ["1.10.0", 0],
    ["2.0.0", 1],
  ]) {
    insert(
      db,
      "INSERT INTO plugin_store_artifacts VALUES(?,?,?)",
      "tenant-a",
      "plugin-a",
      version,
    );
    insert(
      db,
      "INSERT INTO plugin_store_sources VALUES(?,?,?,?)",
      "tenant-a",
      "plugin-a",
      version,
      "{}",
    );
    if (version === "1.10.0")
      insert(
        db,
        "INSERT INTO studio_extension_installations VALUES(?,?,?,?)",
        "tenant-a",
        "plugin-a",
        version,
        enabled,
      );
  }
  for (const version of ["1.9.0", "1.10.0", "2.0.0"])
    insert(
      db,
      "INSERT INTO plugin_store_artifacts VALUES(?,?,?)",
      "tenant-b",
      "plugin-a",
      version,
    );
  const result = await runCleanup({ agencyPreview: db }, { maxBatches: 5 });
  assert.deepEqual(versions(db, "tenant-a", "plugin-a"), ["1.10.0", "2.0.0"]);
  assert.deepEqual(versions(db, "tenant-b", "plugin-a"), ["2.0.0"]);
  assert.equal(result.targets.agencyPreview.pluginArtifacts.deleted, 3);
  assert.equal(
    db.database
      .prepare("SELECT count(*) AS count FROM plugin_store_sources")
      .get().count,
    2,
  );
  assert.equal(
    db.database
      .prepare("SELECT count(*) AS count FROM studio_extension_installations")
      .get().count,
    1,
  );
});

test("plugin cleanup uses SemVer precedence for prereleases and numeric identifiers", async () => {
  const db = d1();
  for (const version of ["1.0.0-rc.9", "1.0.0-rc.10", "1.0.0"]) {
    insert(
      db,
      "INSERT INTO plugin_store_artifacts VALUES(?,?,?)",
      "tenant-a",
      "plugin-a",
      version,
    );
  }
  for (const version of ["1.0.0+build.1", "1.0.0+build.2", "0.9.0"]) {
    insert(
      db,
      "INSERT INTO plugin_store_artifacts VALUES(?,?,?)",
      "tenant-a",
      "plugin-b",
      version,
    );
  }
  await runCleanup({ agencyPreview: db }, { initial: true, maxBatches: 5 });
  assert.deepEqual(versions(db, "tenant-a", "plugin-a"), ["1.0.0"]);
  assert.deepEqual(versions(db, "tenant-a", "plugin-b"), [
    "1.0.0+build.1",
    "1.0.0+build.2",
  ]);
});

test("plugin artifact deletion stays within the batch budget and resumes safely", async () => {
  const db = d1();
  for (const version of ["1.0.0", "2.0.0", "3.0.0", "4.0.0"])
    insert(
      db,
      "INSERT INTO plugin_store_artifacts VALUES(?,?,?)",
      "tenant-a",
      "plugin-a",
      version,
    );
  const first = await runCleanup(
    { agencyBranch: db },
    { batchSize: 1, maxBatches: 1 },
  );
  assert.equal(first.targets.agencyBranch.pluginArtifacts.deleted, 1);
  assert.equal(first.targets.agencyBranch.pluginArtifacts.remaining, true);
  const second = await runCleanup(
    { agencyBranch: db },
    { batchSize: 1, maxBatches: 5 },
  );
  assert.equal(second.targets.agencyBranch.pluginArtifacts.deleted, 2);
  assert.equal(second.targets.agencyBranch.pluginArtifacts.remaining, false);
  assert.deepEqual(versions(db, "tenant-a", "plugin-a"), ["4.0.0"]);
});

test("invalid plugin versions are retained rather than guessed", async () => {
  const db = d1();
  for (const version of ["1.0.0", "latest"])
    insert(
      db,
      "INSERT INTO plugin_store_artifacts VALUES(?,?,?)",
      "tenant-a",
      "plugin-a",
      version,
    );
  const result = await runCleanup({ agencyPreview: db }, { maxBatches: 5 });
  assert.deepEqual(versions(db, "tenant-a", "plugin-a"), ["1.0.0", "latest"]);
  assert.equal(
    result.targets.agencyPreview.pluginArtifacts.invalidVersionGroups,
    1,
  );
});

test("initial cleanup removes report/chunk records but preserves source records", async () => {
  const db = d1();
  for (const kind of [
    "report",
    "chunk",
    "dossier",
    "document",
    "requirement",
    "job",
  ])
    insert(
      db,
      "INSERT INTO dossier_records VALUES(?,?,?,?,?,?)",
      "owner-a",
      kind,
      `${kind}-1`,
      1,
      "{}",
      1_792_600_000_000,
    );
  const result = await runCleanup(
    { secop: db },
    { initial: true, maxBatches: 5 },
  );
  assert.equal(result.targets.secop.dossierRecords.deleted, 2);
  assert.deepEqual(
    db.database
      .prepare("SELECT kind FROM dossier_records ORDER BY kind")
      .all()
      .map((row) => row.kind),
    ["document", "dossier", "job", "requirement"],
  );
});

test("daily SECOP cleanup uses millisecond cutoff and bounded batches", async () => {
  const db = d1();
  const now = 1_792_800_000_000;
  for (const [kind, id, updatedAt] of [
    ["report", "old-1", now - 86_400_001],
    ["chunk", "old-2", now - 86_400_002],
    ["chunk", "new", now - 86_400_000],
    ["report", "other-owner", now - 86_400_002],
  ])
    insert(
      db,
      "INSERT INTO dossier_records VALUES(?,?,?,?,?,?)",
      id === "other-owner" ? "owner-b" : "owner-a",
      kind,
      id,
      1,
      "{}",
      updatedAt,
    );
  const result = await runCleanup(
    { secopValidation: db },
    {
      now,
      maxBatches: 1,
      batchSize: 1,
    },
  );
  assert.equal(result.targets.secopValidation.dossierRecords.deleted, 1);
  assert.equal(result.targets.secopValidation.dossierRecords.remaining, true);
  const continuation = await runCleanup(
    { secopValidation: db },
    {
      now,
      maxBatches: 5,
      batchSize: 1,
    },
  );
  assert.equal(continuation.targets.secopValidation.dossierRecords.deleted, 2);
  assert.equal(
    continuation.targets.secopValidation.dossierRecords.remaining,
    false,
  );
  assert.deepEqual(
    db.database
      .prepare("SELECT id FROM dossier_records ORDER BY id")
      .all()
      .map((row) => row.id),
    ["new"],
  );
});

test("initial mode deletes every terminal run regardless of age and keeps pending runs", async () => {
  const db = d1();
  insert(
    db,
    "INSERT INTO extension_action_runs VALUES(?,?,?,?,?,?)",
    "tenant-a",
    "old-terminal",
    "expired",
    "{}",
    "{}",
    "2020-01-01T00:00:00.000Z",
  );
  insert(
    db,
    "INSERT INTO extension_action_runs VALUES(?,?,?,?,?,?)",
    "tenant-a",
    "recent-terminal",
    "succeeded",
    "{}",
    "{}",
    "2026-10-24T11:59:59.000Z",
  );
  insert(
    db,
    "INSERT INTO extension_action_runs VALUES(?,?,?,?,?,?)",
    "tenant-a",
    "pending",
    "pending",
    "{}",
    null,
    "2020-01-01T00:00:00.000Z",
  );
  const initial = await runCleanup(
    { agencyProduction: db },
    {
      initial: true,
      now: Date.parse("2026-10-24T12:00:00.000Z"),
      maxBatches: 5,
    },
  );
  assert.equal(initial.targets.agencyProduction.extensionRuns.deleted, 2);
  assert.equal(initial.targets.agencyProduction.extensionRuns.remaining, false);
  assert.deepEqual(
    db.database
      .prepare("SELECT run_id FROM extension_action_runs")
      .all()
      .map((row) => row.run_id),
    ["pending"],
  );
});
