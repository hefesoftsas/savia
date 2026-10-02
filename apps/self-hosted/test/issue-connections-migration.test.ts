import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";
import { SqliteDatabase } from "../src/sqlite";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
let temporaryDirectory: string | undefined;

afterEach(() => {
  if (temporaryDirectory)
    rmSync(temporaryDirectory, { recursive: true, force: true });
  temporaryDirectory = undefined;
});

it("preserves saved personal connections and audit foreign keys while widening providers", async () => {
  const migrationsDirectory = join(root, "packages/db/migrations");
  temporaryDirectory = mkdtempSync(join(tmpdir(), "savia-issue-migration-"));
  const priorMigrationsDirectory = join(temporaryDirectory, "prior-migrations");
  mkdirSync(priorMigrationsDirectory);
  for (const filename of readdirSync(migrationsDirectory).filter(
    (name) => name.endsWith(".sql") && name < "0009_issue_connections.sql",
  ))
    copyFileSync(
      join(migrationsDirectory, filename),
      join(priorMigrationsDirectory, filename),
    );

  const database = new SqliteDatabase(":memory:");
  try {
    await database.migrate(priorMigrationsDirectory);
    await database
      .prepare(
        `INSERT INTO identity_principal (
          id, issuer, subject, email, display_name, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        "existing-principal",
        "test-issuer",
        "existing-subject",
        "existing@example.test",
        "Existing User",
        "2026-01-01T00:00:00.000Z",
        "2026-01-01T00:00:00.000Z",
      )
      .run();
    await database
      .prepare(
        `INSERT INTO personal_integration_connections (
          id, principal_id, provider, nango_connection_id, nango_integration_id,
          status, scopes, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        "existing-connection",
        "existing-principal",
        "google_drive",
        "nango-existing-connection",
        "google-drive-existing",
        "connected",
        '["drive.readonly"]',
        "2026-01-01T00:00:00.000Z",
        "2026-01-01T00:00:00.000Z",
      )
      .run();
    await database
      .prepare(
        `INSERT INTO personal_integration_audit_events (
          id, connection_id, principal_id, provider, event_type, outcome, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        "existing-audit-event",
        "existing-connection",
        "existing-principal",
        "google_drive",
        "upload-file",
        "succeeded",
        "2026-01-01T00:00:00.000Z",
      )
      .run();

    await database.migrate(migrationsDirectory);

    await expect(
      database
        .prepare(
          "SELECT provider, nango_connection_id, scopes FROM personal_integration_connections WHERE id=?",
        )
        .bind("existing-connection")
        .first(),
    ).resolves.toEqual({
      provider: "google_drive",
      nango_connection_id: "nango-existing-connection",
      scopes: '["drive.readonly"]',
    });
    await expect(
      database
        .prepare(
          "SELECT connection_id, provider FROM personal_integration_audit_events WHERE id=?",
        )
        .bind("existing-audit-event")
        .first(),
    ).resolves.toEqual({
      connection_id: "existing-connection",
      provider: "google_drive",
    });
    await expect(
      database.prepare("PRAGMA foreign_key_check").all(),
    ).resolves.toMatchObject({ results: [] });
    await expect(
      database
        .prepare(
          `INSERT INTO personal_integration_connections (
            id, principal_id, provider, nango_connection_id, nango_integration_id,
            status, scopes, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          "new-jira-connection",
          "existing-principal",
          "jira",
          "nango-jira-connection",
          "jira-integration",
          "connected",
          "[]",
          "2026-01-02T00:00:00.000Z",
          "2026-01-02T00:00:00.000Z",
        )
        .run(),
    ).resolves.toMatchObject({ success: true });
  } finally {
    database.close();
  }
});
