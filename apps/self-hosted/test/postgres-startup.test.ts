import { expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { migratePostgres } from "../src/postgres/migrations";
import { createApplication } from "../src/application";
import { loadConfiguration } from "../src/config";
import { PostgresDatabase } from "../src/postgres/database";
import { postgresTestUrl, withPostgresFixture } from "./postgres-fixture";

function configuration(url: string, directory: string) {
  return loadConfiguration({
    SAVIA_DATABASE_DRIVER: "postgres",
    SAVIA_POSTGRES_URL: url,
    SAVIA_PUBLIC_ORIGIN: "http://localhost:8080",
    SAVIA_DATA_DIR: directory,
    SAVIA_AUTH_SECRET: "native-startup-auth-".repeat(4),
    SAVIA_ENCRYPTION_KEY: "native-startup-encryption-".repeat(4),
    SAVIA_CAPTCHA_SECRET: "native-startup-captcha-".repeat(4),
    SAVIA_BOOTSTRAP_EMAIL: "startup@example.test",
    SAVIA_BOOTSTRAP_PASSWORD: "Native-Startup-Password-123!",
    S3_ENDPOINT: "http://127.0.0.1:1",
    S3_PUBLIC_ENDPOINT: "http://127.0.0.1:1",
    S3_ACCESS_KEY_ID: "test-access",
    S3_SECRET_ACCESS_KEY: "native-startup-storage-secret",
  });
}
it.skipIf(!postgresTestUrl)(
  "serializes simultaneous native application initialization and bootstraps once",
  async () => {
    await withPostgresFixture(async (db, url) => {
      const directory = mkdtempSync(join(tmpdir(), "savia-native-startup-"));
      const applications: Awaited<ReturnType<typeof createApplication>>[] = [];
      try {
        const config = configuration(url, directory);
        const results = await Promise.allSettled([
          createApplication(config, {}),
          createApplication(config, {}),
        ]);
        for (const result of results)
          if (result.status === "fulfilled") applications.push(result.value);
        expect(results.map((result) => result.status)).toEqual([
          "fulfilled",
          "fulfilled",
        ]);
        expect(
          await db
            .prepare(
              'SELECT count(*) AS n FROM savia_auth."user" WHERE email=?',
            )
            .bind("startup@example.test")
            .first("n"),
        ).toBe(1);
        expect(
          await db
            .prepare('SELECT count(*) AS n FROM savia_auth."oauthClient"')
            .first("n"),
        ).toBe(2);
        const histories = await db
          .prepare(
            "SELECT filename,count(*) AS n FROM savia_core._savia_postgres_migrations GROUP BY filename",
          )
          .all<{ filename: string; n: number }>();
        expect(histories.results.length).toBeGreaterThan(0);
        expect(histories.results.every((row) => row.n === 1)).toBe(true);
        for (const app of applications)
          expect(
            (
              await app.fetch(
                new Request("http://localhost:8080/api/auth/get-session"),
              )
            ).status,
          ).toBe(200);
      } finally {
        await Promise.all(applications.map((app) => app.close()));
        rmSync(directory, { recursive: true, force: true });
      }
    });
  },
  180_000,
);

it.skipIf(!postgresTestUrl)(
  "closes all native database pools when application startup fails",
  async () => {
    await withPostgresFixture(async (_db, url) => {
      const directory = mkdtempSync(
        join(tmpdir(), "savia-native-failed-startup-"),
      );
      const closed: PostgresDatabase[] = [];
      const close = PostgresDatabase.prototype.close;
      const spy = vi
        .spyOn(PostgresDatabase.prototype, "close")
        .mockImplementation(async function (this: PostgresDatabase) {
          closed.push(this);
          await close.call(this);
        });
      try {
        // Invalid startup configuration fails before any SMTP network operation.
        await expect(
          createApplication(configuration(url, directory), {
            SAVIA_SMTP_HOST: "smtp.example.test",
          }),
        ).rejects.toThrow("SAVIA_SMTP_FROM is required");
        expect(closed).toHaveLength(3);
        for (const db of closed)
          await expect(db.prepare("SELECT 1").first()).rejects.toThrow(
            /pool.*end/i,
          );
      } finally {
        spy.mockRestore();
        rmSync(directory, { recursive: true, force: true });
      }
    });
  },
  180_000,
);

for (const failure of ["credentials", "unreachable", "checksum"] as const) {
  it.skipIf(!postgresTestUrl)(
    `closes all native stores after ${failure} initialization failure`,
    async () => {
      await withPostgresFixture(async (core, url) => {
        const directory = mkdtempSync(
          join(tmpdir(), "savia-native-init-failure-"),
        );
        const connection = new URL(url);
        if (failure === "credentials") {
          connection.username = "savia_invalid_credentials_contract";
          connection.password = "deliberately-invalid-contract-password";
        } else if (failure === "unreachable") {
          connection.hostname = "127.0.0.1";
          connection.port = "1";
        } else {
          await migratePostgres({
            connectionString: url,
            schema: "savia_core",
            directory: resolve("../../packages/db/postgres"),
            seed: false,
          });
          await core
            .prepare(
              "UPDATE _savia_postgres_migrations SET checksum=? WHERE position=(SELECT MIN(position) FROM _savia_postgres_migrations)",
            )
            .bind("invalid-checksum-contract")
            .run();
        }
        const closed: PostgresDatabase[] = [];
        const close = PostgresDatabase.prototype.close;
        const spy = vi
          .spyOn(PostgresDatabase.prototype, "close")
          .mockImplementation(async function (this: PostgresDatabase) {
            closed.push(this);
            await close.call(this);
          });
        try {
          await expect(
            createApplication(
              configuration(connection.toString(), directory),
              {},
            ),
          ).rejects.toThrow(
            failure === "checksum" ? /checksum/i : /connect.*PostgreSQL/i,
          );
          expect(closed).toHaveLength(3);
          expect(new Set(closed).size).toBe(3);
          for (const db of closed)
            await expect(db.prepare("SELECT 1").first()).rejects.toThrow(
              /pool.*end/i,
            );
          if (failure === "checksum") {
            expect(
              await core
                .prepare(
                  "SELECT count(*) AS n FROM information_schema.tables WHERE table_schema='savia_request'",
                )
                .first("n"),
            ).toBe(0);
            expect(
              await core
                .prepare(
                  "SELECT count(*) AS n FROM information_schema.tables WHERE table_schema='savia_auth'",
                )
                .first("n"),
            ).toBe(0);
          }
        } finally {
          spy.mockRestore();
          rmSync(directory, { recursive: true, force: true });
        }
      });
    },
    180_000,
  );
}
