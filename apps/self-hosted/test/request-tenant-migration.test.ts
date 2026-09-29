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
