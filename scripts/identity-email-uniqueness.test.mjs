import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

const directory = new URL("../packages/db/migrations/", import.meta.url);
const migration = new URL("0078_identity_principal_email_uniqueness.sql", directory);

function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  for (const file of readdirSync(directory)
    .filter((file) => file.endsWith(".sql") && file < "0078")
    .sort()) {
    db.exec(readFileSync(new URL(file, directory), "utf8"));
  }
  return db;
}

function insertPrincipal(db, id, issuer, subject, email, isActive = 1) {
  db.prepare(
    `INSERT INTO identity_principal
       (id,issuer,subject,email,display_name,is_active,created_at,updated_at)
     VALUES(?,?,?,?,?,?,?,?)`,
  ).run(id, issuer, subject, email, id, isActive, "now", "now");
}

function applyMigration(db) {
  db.exec(readFileSync(migration, "utf8"));
}

test("preserves historical duplicate principals and blocks future active email collisions", () => {
  const db = fixture();
  try {
    insertPrincipal(db, "legacy-a", "issuer-a", "subject-a", " Shared@Example.test ");
    insertPrincipal(db, "legacy-b", "issuer-b", "subject-b", "shared@example.test");

    applyMigration(db);

    assert.equal(
      db.prepare("SELECT COUNT(*) AS n FROM identity_principal").get().n,
      2,
    );
    assert.throws(
      () => insertPrincipal(db, "new", "issuer-c", "subject-c", " SHARED@example.test "),
      /IDENTITY_EMAIL_CONFLICT/,
    );

    // Existing login upserts are keyed by issuer and subject and can repair or
    // refresh their row even when legacy data already contains duplicates.
    db.prepare(`
      INSERT INTO identity_principal
        (id,issuer,subject,email,display_name,is_active,created_at,updated_at)
      VALUES('legacy-a','issuer-a','subject-a','shared@example.test','Updated',1,'now','now')
      ON CONFLICT(issuer,subject) DO UPDATE SET
        email=excluded.email, display_name=excluded.display_name, updated_at=excluded.updated_at
    `).run();
    assert.equal(
      db.prepare("SELECT display_name FROM identity_principal WHERE id='legacy-a'").get().display_name,
      "Updated",
    );

    insertPrincipal(db, "different", "issuer-c", "subject-c", "other@example.test");
  } finally {
    db.close();
  }
});

test("rejects colliding email changes and activation while allowing inactive duplicate records", () => {
  const db = fixture();
  try {
    insertPrincipal(db, "active", "issuer-a", "active", "person@example.test");
    insertPrincipal(db, "active-update", "issuer-b", "update-active", "old@example.test");
    insertPrincipal(db, "inactive-update", "issuer-b", "update", "old@example.test", 0);
    insertPrincipal(db, "inactive-reactivate", "issuer-c", "reactivate", "person@example.test", 0);
    applyMigration(db);

    assert.throws(
      () => db.prepare("UPDATE identity_principal SET email=' Person@Example.test ' WHERE id='active-update'").run(),
      /IDENTITY_EMAIL_CONFLICT/,
    );
    assert.throws(
      () => db.prepare("UPDATE identity_principal SET is_active=1 WHERE id='inactive-reactivate'").run(),
      /IDENTITY_EMAIL_CONFLICT/,
    );

    db.prepare("UPDATE identity_principal SET is_active=0 WHERE id='active'").run();
    db.prepare("UPDATE identity_principal SET is_active=1 WHERE id='inactive-reactivate'").run();
    assert.equal(
      db.prepare("SELECT is_active FROM identity_principal WHERE id='inactive-reactivate'").get().is_active,
      1,
    );
  } finally {
    db.close();
  }
});
