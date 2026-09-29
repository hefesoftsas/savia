import { expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteDatabase } from "../src/sqlite";
import { seedRequestTenantMigration } from "../src/request-tenant-migration";

it("copies custom tenant migration identities into the separate Request store", async () => {
  const directory = mkdtempSync(join(tmpdir(), "savia-request-tenants-"));
  const core = new SqliteDatabase(join(directory, "core.sqlite"));
  const request = new SqliteDatabase(join(directory, "request.sqlite"));
  try {
    await core.exec(
      "CREATE TABLE tenant_namespace_migrations(old_key TEXT PRIMARY KEY,tenant_id BIGINT NOT NULL); INSERT INTO tenant_namespace_migrations VALUES('domain:research',31),('domain:platform',0)",
    );
    await seedRequestTenantMigration(core, request);
    await seedRequestTenantMigration(core, request);
    expect(
      await request
        .prepare(
          "SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key='domain:research'",
        )
        .first("tenant_id"),
    ).toBe(31);
    expect(
      await request
        .prepare("SELECT COUNT(*) n FROM tenant_namespace_migrations")
        .first("n"),
    ).toBe(2);
    await request
      .prepare(
        "UPDATE tenant_namespace_migrations SET tenant_id=99 WHERE old_key='domain:research'",
      )
      .run();
    await expect(seedRequestTenantMigration(core, request)).rejects.toThrow(
      "conflicts with core mapping",
    );
    expect(
      await request
        .prepare(
          "SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key='domain:research'",
        )
        .first("tenant_id"),
    ).toBe(99);
  } finally {
    core.close();
    request.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

import { copyFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { migratePostgres } from "../src/postgres/migrations";
import { openPostgresDatabase } from "../src/postgres/database";
import { postgresTestUrl, withPostgresFixture } from "./postgres-fixture";

for (const collision of [false, true]) {
  it.skipIf(!postgresTestUrl)(
    `migrates separate native Request ownership (collision=${collision})`,
    async () => {
      const source = resolve(
        import.meta.dirname,
        "../../savia-request/postgres",
      );
      const migration = "0005_tenant_only_isolation.sql";
      const directory = mkdtempSync(join(tmpdir(), "savia-request-native-"));
      try {
        for (const name of readdirSync(source).filter(
          (name) => name.endsWith(".sql") && name < migration,
        ))
          copyFileSync(join(source, name), join(directory, name));
        await withPostgresFixture(async (core, connectionString) => {
          const request = openPostgresDatabase({
            connectionString,
            schema: "savia_request",
            maxConnections: 2,
          });
          try {
            const options = {
              connectionString,
              schema: "savia_request" as const,
              directory,
              seed: true,
            };
            await migratePostgres(options);
            await core
              .prepare(
                "CREATE TABLE tenant_namespace_migrations(old_key TEXT PRIMARY KEY,tenant_id BIGINT NOT NULL)",
              )
              .run();
            await core
              .prepare(
                "INSERT INTO tenant_namespace_migrations VALUES('domain:research',31),('domain:platform',0)",
              )
              .run();
            await request
              .prepare(
                "INSERT INTO tenant_flows VALUES('domain:research','flow','{}','now')",
              )
              .run();
            await request
              .prepare(
                "INSERT INTO tenant_flow_variables VALUES('domain:research','flow','key','sealed-secret',1,'now')",
              )
              .run();
            if (collision)
              await request
                .prepare(
                  "INSERT INTO tenant_flows VALUES('tenant:31','flow','{}','now')",
                )
                .run();
            await seedRequestTenantMigration(core, request);
            copyFileSync(join(source, migration), join(directory, migration));
            if (collision) {
              await expect(migratePostgres(options)).rejects.toThrow(
                /collision/,
              );
              expect(
                await request
                  .prepare("SELECT tenant_id FROM tenant_flow_variables")
                  .first("tenant_id"),
              ).toBe("domain:research");
            } else {
              expect(await migratePostgres(options)).toEqual([migration]);
              expect(
                await request
                  .prepare(
                    "SELECT tenant_id FROM tenant_flows WHERE flow_id='flow'",
                  )
                  .first("tenant_id"),
              ).toBe("tenant:31");
              expect(
                await request
                  .prepare(
                    "SELECT value FROM tenant_flow_variables WHERE tenant_id='tenant:31'",
                  )
                  .first("value"),
              ).toBe("sealed-secret");
              expect(await migratePostgres(options)).toEqual([]);
            }
          } finally {
            await request.close();
          }
        });
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
    120000,
  );
}
