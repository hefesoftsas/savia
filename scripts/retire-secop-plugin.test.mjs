import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

test("retired SECOP plugin artifacts are archived and removed without affecting other data", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("PRAGMA foreign_keys=ON");
    const migrationFiles = readdirSync("packages/db/migrations")
      .filter((file) => file.endsWith(".sql"))
      .sort();
    const retirementMigration = "0061_retire_secop_plugin.sql";
    for (const file of migrationFiles.filter(
      (name) => name < retirementMigration,
    ))
      db.exec(readFileSync(`packages/db/migrations/${file}`, "utf8"));

    const insertArtifact = db.prepare(`
      INSERT INTO plugin_store_artifacts
        (tenant_id,id,version,manifest,entry_js,sha256,size_bytes,created_by,store_json)
      VALUES (?,?,?,?,?,?,?,?,?)
    `);
    const insertSource = db.prepare(
      "INSERT INTO plugin_store_sources(tenant_id,id,version,files) VALUES(?,?,?,?)",
    );
    const insertInstallation = db.prepare(`
      INSERT INTO studio_extension_installations
        (tenant_id,id,version,enabled,manifest)
      VALUES (?,?,?,?,?)
    `);
    const seedPlugin = (tenantId, id, version, enabled = 1, install = true) => {
      const manifest = JSON.stringify({ id, version });
      insertArtifact.run(
        tenantId,
        id,
        version,
        manifest,
        `export const id = ${JSON.stringify(id)};`,
        `${id}-${version}-digest`,
        24,
        "migration-test",
        JSON.stringify({ catalog: id }),
      );
      insertSource.run(
        tenantId,
        id,
        version,
        JSON.stringify({
          "src/index.ts": `export default ${JSON.stringify(id)}`,
        }),
      );
      if (install)
        insertInstallation.run(tenantId, id, version, enabled, manifest);
    };

    seedPlugin("tenant-a", "procurement.secop", "1.0.0", 0);
    seedPlugin("tenant-a", "procurement.secop", "1.1.0", 1, false);
    seedPlugin("tenant-b", "procurement.secop", "1.0.0");
    seedPlugin("tenant-a", "inventory.tools", "2.0.0");

    db.exec(`
      INSERT INTO studio_objects(tenant_id,name,label,config)
      VALUES ('tenant-a','orders','Orders','{}');
      INSERT INTO studio_records(id,tenant_id,object_name,data)
      VALUES ('order-1','tenant-a','orders','{"status":"open"}');
    `);

    const rows = (table, id) =>
      db
        .prepare(`SELECT * FROM ${table} WHERE id=? ORDER BY tenant_id,version`)
        .all(id);
    const installationsBefore = rows(
      "studio_extension_installations",
      "procurement.secop",
    );
    const artifactsBefore = rows("plugin_store_artifacts", "procurement.secop");
    const sourcesBefore = rows("plugin_store_sources", "procurement.secop");
    const unrelatedInstallationBefore = rows(
      "studio_extension_installations",
      "inventory.tools",
    );
    const unrelatedArtifactBefore = rows(
      "plugin_store_artifacts",
      "inventory.tools",
    );
    const unrelatedSourceBefore = rows(
      "plugin_store_sources",
      "inventory.tools",
    );
    const businessRecordBefore = db
      .prepare("SELECT * FROM studio_records WHERE tenant_id='tenant-a'")
      .all();
    const schemaBefore = db
      .prepare(
        `
        SELECT type,name,tbl_name,sql FROM sqlite_master
        WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name
      `,
      )
      .all();
    const triggersBefore = schemaBefore.filter(
      (object) => object.type === "trigger",
    );

    assert.equal(installationsBefore.length, 2);
    assert.equal(artifactsBefore.length, 3);
    assert.equal(sourcesBefore.length, 3);
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);

    db.exec(
      readFileSync(`packages/db/migrations/${retirementMigration}`, "utf8"),
    );

    assert.deepEqual(
      db
        .prepare(
          "SELECT * FROM retired_secop_installations ORDER BY tenant_id,version",
        )
        .all(),
      installationsBefore,
    );
    assert.deepEqual(
      db
        .prepare(
          "SELECT * FROM retired_secop_artifacts ORDER BY tenant_id,version",
        )
        .all(),
      artifactsBefore,
    );
    assert.deepEqual(
      db
        .prepare(
          "SELECT * FROM retired_secop_sources ORDER BY tenant_id,version",
        )
        .all(),
      sourcesBefore,
    );
    assert.deepEqual(
      rows("studio_extension_installations", "procurement.secop"),
      [],
    );
    assert.deepEqual(rows("plugin_store_artifacts", "procurement.secop"), []);
    assert.deepEqual(rows("plugin_store_sources", "procurement.secop"), []);

    assert.deepEqual(
      rows("studio_extension_installations", "inventory.tools"),
      unrelatedInstallationBefore,
    );
    assert.deepEqual(
      rows("plugin_store_artifacts", "inventory.tools"),
      unrelatedArtifactBefore,
    );
    assert.deepEqual(
      rows("plugin_store_sources", "inventory.tools"),
      unrelatedSourceBefore,
    );
    assert.deepEqual(
      db
        .prepare("SELECT * FROM studio_records WHERE tenant_id='tenant-a'")
        .all(),
      businessRecordBefore,
    );

    const schemaAfter = db
      .prepare(
        `
        SELECT type,name,tbl_name,sql FROM sqlite_master
        WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name
      `,
      )
      .all();
    assert.deepEqual(
      schemaAfter.filter((object) => !object.name.startsWith("retired_secop_")),
      schemaBefore,
      "retirement should leave active schema and indexes unchanged",
    );
    assert.deepEqual(
      schemaAfter.filter((object) => object.type === "trigger"),
      triggersBefore,
      "retirement should preserve triggers",
    );
    const postgresManifest = JSON.parse(
      readFileSync("packages/db/postgres/manifest.json", "utf8"),
    );
    const sqliteMigration = readFileSync(
      `packages/db/migrations/${retirementMigration}`,
    );
    assert.equal(
      postgresManifest.sourceMigrations.find(
        (migration) => migration.filename === retirementMigration,
      )?.sha256,
      createHash("sha256").update(sqliteMigration).digest("hex"),
      "native manifest should pin the SQLite migration used for import",
    );
    const postgresMigration = readFileSync(
      "packages/db/postgres/0061_retire_secop_plugin.sql",
      "utf8",
    ).replace(/\s+/g, " ");
    for (const [archive, source] of [
      ["retired_secop_installations", "studio_extension_installations"],
      ["retired_secop_artifacts", "plugin_store_artifacts"],
      ["retired_secop_sources", "plugin_store_sources"],
    ]) {
      assert.ok(
        postgresMigration.includes(
          `CREATE TABLE savia_core.${archive} AS SELECT * FROM savia_core.${source} WHERE id = 'procurement.secop';`,
        ),
        `PostgreSQL migration should archive ${source} with source column types`,
      );
      const manifestObject = postgresManifest.objects.find(
        (object) => object.name === archive,
      );
      assert.deepEqual(manifestObject, {
        type: "table",
        name: archive,
        table: archive,
      });
      const archivedTable = postgresManifest.tables.find(
        (table) => table.name === archive,
      );
      const sqliteColumns = db.prepare(`PRAGMA table_info(${archive})`).all();
      assert.deepEqual(
        archivedTable?.columns,
        JSON.parse(JSON.stringify(sqliteColumns)),
      );
      assert.deepEqual(archivedTable?.foreignKeys, []);
      assert.deepEqual(archivedTable?.uniqueKeys, []);
      assert.equal(archivedTable?.checkCount, 0);
      assert.ok(
        archivedTable.columns.every(
          (column) => column.notnull === 0 && column.pk === 0,
        ),
        `${archive} should remain an unconstrained historical snapshot`,
      );
    }
    assert.ok(
      postgresMigration.indexOf("DELETE FROM savia_core.plugin_store_sources") <
        postgresMigration.indexOf(
          "DELETE FROM savia_core.plugin_store_artifacts",
        ),
      "source rows must be deleted before their referenced artifacts",
    );
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    db.close();
  }
});
