import {
  cpSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { openSqliteDatabase } from "../src/sqlite";
import { migratePostgres } from "../src/postgres/migrations.js";
import { withPostgresFixture } from "./postgres-fixture";
import { createJiraPrivacyRepository } from "../../api/src/personal-integrations/jira-privacy-repository";

const root = resolve(import.meta.dirname, "../../..");
const migrationDirectory = join(root, "packages/db/migrations");

describe("Jira privacy SQLite migration", () => {
  it("adds durable tables and clears disconnected legacy Jira identity only", async () => {
    const database = openSqliteDatabase(":memory:");
    try {
      database.exec("CREATE TABLE _migration_test (id INTEGER)");
      for (const filename of readdirSync(migrationDirectory)
        .filter((name) => name.endsWith(".sql"))
        .sort()) {
        const source = readFileSync(join(migrationDirectory, filename), "utf8");
        if (filename === "0015_jira_privacy_reporting.sql") {
          await database
            .prepare(
              `INSERT INTO identity_principal
            (id,issuer,subject,email,display_name,is_active,created_at,updated_at)
            VALUES ('migration-owner','test','migration-owner','owner@test','Owner',1,'2026-01-01','2026-01-01')`,
            )
            .run();
          for (const [id, provider, disconnected] of [
            ["jira-old", "jira", "2026-01-02"],
            ["jira-live", "jira", null],
            ["gmail-old", "gmail", "2026-01-02"],
          ] as const)
            await database
              .prepare(
                `INSERT INTO personal_integration_connections
              (id,principal_id,provider,nango_connection_id,nango_integration_id,status,
               external_account_label,external_account_id,scopes,disconnected_at,created_at,updated_at)
              VALUES (?,'migration-owner',?,?,?,'disconnected','Stored label','stored-id','[]',?,'2026-01-01','2026-01-01')`,
              )
              .bind(
                id,
                provider,
                provider === "jira" ? "jira-integration" : "gmail-integration",
                provider,
                disconnected,
              )
              .run();
        }
        for (const statement of source
          .split("--> statement-breakpoint")
          .map((sql) => sql.trim())
          .filter(Boolean))
          await database.exec(statement);
      }

      expect(
        await database
          .prepare(
            `SELECT external_account_id, external_account_label
        FROM personal_integration_connections WHERE id='jira-old'`,
          )
          .first(),
      ).toEqual({ external_account_id: null, external_account_label: null });
      expect(
        await database
          .prepare(
            `SELECT external_account_id, external_account_label
        FROM personal_integration_connections WHERE id='jira-live'`,
          )
          .first(),
      ).toEqual({
        external_account_id: "stored-id",
        external_account_label: "Stored label",
      });
      expect(
        await database
          .prepare(
            `SELECT external_account_id, external_account_label
        FROM personal_integration_connections WHERE id='gmail-old'`,
          )
          .first(),
      ).toEqual({
        external_account_id: "stored-id",
        external_account_label: "Stored label",
      });
      expect(
        (
          await database
            .prepare("PRAGMA table_info(personal_integration_connections)")
            .all()
        ).results.map((row) => row.name),
      ).toContain("jira_privacy_generation");
      expect(
        (
          await database
            .prepare(
              "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'jira_privacy_%' ORDER BY name",
            )
            .all()
        ).results.map((row) => row.name),
      ).toEqual([
        "jira_privacy_accounts",
        "jira_privacy_connections",
        "jira_privacy_integrations",
      ]);
    } finally {
      database.close();
    }
  });

  it.skipIf(!process.env.SAVIA_TEST_POSTGRES_URL)(
    "applies the PostgreSQL privacy migration and clears disconnected Jira fields",
    async () => {
      await withPostgresFixture(async (database, connectionString) => {
        const postgresDirectory = join(root, "packages/db/postgres");
        const beforePrivacy = mkdtempSync(
          join(tmpdir(), "savia-postgres-pre-privacy-"),
        );
        try {
          for (const filename of readdirSync(postgresDirectory).filter(
            (name) =>
              name.endsWith(".sql") &&
              name !== "0015_jira_privacy_reporting.sql",
          ))
            cpSync(
              join(postgresDirectory, filename),
              join(beforePrivacy, filename),
            );
          await migratePostgres({
            connectionString,
            schema: "savia_core",
            directory: beforePrivacy,
            seed: false,
          });
          await database
            .prepare(
              `INSERT INTO identity_principal
          (id,issuer,subject,email,display_name,is_active,created_at,updated_at)
          VALUES ('migration-owner','test','migration-owner','owner@test','Owner',1,'2026-01-01','2026-01-01')`,
            )
            .run();
          await database
            .prepare(
              `INSERT INTO personal_integration_connections
          (id,principal_id,provider,nango_connection_id,nango_integration_id,status,
           external_account_label,external_account_id,scopes,disconnected_at,created_at,updated_at)
          VALUES ('jira-old','migration-owner','jira','nango-jira','jira','disconnected',
            'Stored label','stored-id','[]','2026-01-02','2026-01-01','2026-01-01')`,
            )
            .run();
          await migratePostgres({
            connectionString,
            schema: "savia_core",
            directory: postgresDirectory,
            seed: false,
          });
          const jira = await database
            .prepare(
              `SELECT external_account_id, external_account_label
          FROM personal_integration_connections WHERE id='jira-old'`,
            )
            .first();
          expect(jira).toEqual({
            external_account_id: null,
            external_account_label: null,
          });
          expect(
            await database
              .prepare(
                "SELECT count(*) AS count FROM jira_privacy_integrations",
              )
              .first(),
          ).toEqual({ count: 0 });
        } finally {
          rmSync(beforePrivacy, { recursive: true, force: true });
        }
      });
    },
  );

  it.skipIf(!process.env.SAVIA_TEST_POSTGRES_URL)(
    "runs privacy reporting and cleanup against native PostgreSQL",
    async () => {
      await withPostgresFixture(async (database, connectionString) => {
        await migratePostgres({
          connectionString,
          schema: "savia_core",
          directory: join(root, "packages/db/postgres"),
          seed: false,
        });
        await database
          .prepare(
            `INSERT INTO identity_principal
        (id,issuer,subject,email,display_name,is_active,created_at,updated_at)
        VALUES ('privacy-owner','test','privacy-owner','owner@test','Owner',1,'2026-01-01','2026-01-01')`,
          )
          .run();

        const repository = createJiraPrivacyRepository(database);
        const completion = {
          principalId: "privacy-owner",
          provider: "jira" as const,
          nangoConnectionId: "nango-one",
          nangoIntegrationId: "jira",
          status: "connected" as const,
          scopes: [],
        };
        await repository.saveVerifiedConnection(completion, {
          accountId: "acct-one",
          label: "Verified",
          retrievedAt: "2026-01-01T00:00:00.000Z",
        });
        const lease = await repository.claimDueReports(
          "jira",
          "2026-07-01T00:00:00.000Z",
        );
        expect(lease.accounts).toHaveLength(1);
        await repository.acceptReport(lease, "2026-07-01T00:00:01.000Z", null, [
          { accountId: "acct-one", status: "closed" },
        ]);
        expect(await repository.getOperationalState("jira")).toMatchObject({
          cycleBlocked: true,
          pendingCleanup: 1,
        });
        const cleanup = await repository.listCleanup(
          "2026-07-01T00:00:01.000Z",
          10,
          "jira",
        );
        expect(cleanup).toHaveLength(1);
        await repository.finishCleanup(cleanup[0], "2026-07-01T00:00:02.000Z");
        expect(
          await repository.listCleanup("2026-07-01T00:00:02.000Z", 10, "jira"),
        ).toHaveLength(0);
        expect(
          await repository.claimDueReports("jira", "2026-07-01T00:00:03.000Z"),
        ).toMatchObject({ accounts: [] });
      });
    },
  );
});
