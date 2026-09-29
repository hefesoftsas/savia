import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

const directory = new URL("../packages/db/migrations/", import.meta.url);
const baselineFiles = ["0001_initial.sql", "0002_bootstrap.sql"];

function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  for (const file of baselineFiles)
    db.exec(readFileSync(new URL(file, directory), "utf8"));
  return db;
}

function insertPrincipal(db, id, issuer, subject, email, isActive = 1) {
  db.prepare(
    `INSERT INTO identity_principal
       (id,issuer,subject,email,display_name,is_active,created_at,updated_at)
     VALUES(?,?,?,?,?,?,?,?)`,
  ).run(id, issuer, subject, email, id, isActive, "now", "now");
}

test("baseline blocks duplicate active emails but permits inactive historical identities", () => {
  const db = fixture();
  try {
    insertPrincipal(
      db,
      "active",
      "issuer-a",
      "subject-a",
      "person@example.test",
    );
    insertPrincipal(
      db,
      "inactive",
      "issuer-b",
      "subject-b",
      "PERSON@example.test",
      0,
    );

    assert.throws(
      () =>
        insertPrincipal(
          db,
          "duplicate",
          "issuer-c",
          "subject-c",
          " Person@Example.test ",
        ),
      /IDENTITY_EMAIL_CONFLICT/,
    );
    assert.throws(
      () =>
        db
          .prepare(
            "UPDATE identity_principal SET is_active=1 WHERE id='inactive'",
          )
          .run(),
      /IDENTITY_EMAIL_CONFLICT/,
    );

    db.prepare(
      "UPDATE identity_principal SET is_active=0 WHERE id='active'",
    ).run();
    db.prepare(
      "UPDATE identity_principal SET is_active=1 WHERE id='inactive'",
    ).run();
    assert.equal(
      db
        .prepare("SELECT is_active FROM identity_principal WHERE id='inactive'")
        .get().is_active,
      1,
    );
  } finally {
    db.close();
  }
});

test("login upserts retain issuer-subject identity while refreshing profile fields", () => {
  const db = fixture();
  try {
    insertPrincipal(
      db,
      "same-user",
      "savia:better-auth",
      "same-user",
      "old@example.test",
    );
    db.prepare(
      `
      INSERT INTO identity_principal
        (id,issuer,subject,email,display_name,is_active,created_at,updated_at)
      VALUES('replacement-id','savia:better-auth','same-user','new@example.test','Updated',1,'now','later')
      ON CONFLICT(issuer,subject) DO UPDATE SET
        email=excluded.email, display_name=excluded.display_name, updated_at=excluded.updated_at
    `,
    ).run();

    assert.deepEqual(
      {
        ...db
          .prepare(
            "SELECT id,email,display_name FROM identity_principal WHERE subject='same-user'",
          )
          .get(),
      },
      { id: "same-user", email: "new@example.test", display_name: "Updated" },
    );
  } finally {
    db.close();
  }
});
