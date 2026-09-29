import { expect, it } from "vitest";
import { mkdtemp, copyFile, readdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { migratePostgres } from "../src/postgres/migrations";
import { postgresTestUrl, withPostgresFixture } from "./postgres-fixture";
const source = resolve(import.meta.dirname, "../../../packages/db/postgres");
const migration = "0018_tenant_only_isolation.sql";
for (const collision of [false, true]) {
  it.skipIf(!postgresTestUrl)(
    `migrates populated PostgreSQL tenant data (collision=${collision})`,
    async () => {
      const directory = await mkdtemp(
        join(tmpdir(), "savia-tenant-migration-"),
      );
      try {
        for (const name of (await readdir(source)).filter(
          (n) => n.endsWith(".sql") && n < migration,
        ))
          await copyFile(join(source, name), join(directory, name));
        await withPostgresFixture(async (db, connectionString) => {
          const options = {
            connectionString,
            schema: "savia_core" as const,
            directory,
            seed: true,
          };
          await migratePostgres(options);
          await db
            .prepare(
              "INSERT INTO studio_data_domains(id,label,created_by) VALUES('research','Research','p')",
            )
            .run();
          await db
            .prepare(
              "INSERT INTO studio_objects(tenant_id,name,label,config) VALUES('domain:research','items','Items','{}'),('domain:platform','items','Platform','{}')",
            )
            .run();
          await db
            .prepare(
              "INSERT INTO studio_records(id,tenant_id,object_name,data) VALUES('r','domain:research','items','{}')",
            )
            .run();
          await db
            .prepare(
              "INSERT INTO studio_geocoding_settings(tenant_id,encrypted_geoapify_key) VALUES('domain:research','iv.ciphertext')",
            )
            .run();
          if (collision)
            await db
              .prepare(
                "INSERT INTO studio_objects(tenant_id,name,label,config) VALUES('tenant:0','items','Collision','{}')",
              )
              .run();
          const constraintTiming = () =>
            db
              .prepare(
                "SELECT conname,condeferrable,condeferred FROM pg_constraint WHERE contype='f' AND connamespace=current_schema()::regnamespace ORDER BY conname",
              )
              .all();
          const beforeTiming = (await constraintTiming()).results;
          await copyFile(join(source, migration), join(directory, migration));
          if (collision) {
            await expect(migratePostgres(options)).rejects.toThrow(
              /tenant_namespace_collision/,
            );
            expect(
              await db
                .prepare("SELECT COUNT(*) AS n FROM studio_data_domains")
                .first("n"),
            ).toBe(1);
            expect(
              await db
                .prepare("SELECT tenant_id FROM studio_records WHERE id='r'")
                .first("tenant_id"),
            ).toBe("domain:research");
          } else {
            expect(await migratePostgres(options)).toEqual([migration]);
            expect((await constraintTiming()).results).toEqual(beforeTiming);
            const id = await db
              .prepare(
                "SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key='domain:research'",
              )
              .first("tenant_id");
            expect(
              await db
                .prepare("SELECT tenant_id FROM studio_records WHERE id='r'")
                .first("tenant_id"),
            ).toBe(`tenant:${id}`);
            const value = await db
              .prepare(
                "SELECT encrypted_geoapify_key FROM studio_geocoding_settings",
              )
              .first<string>("encrypted_geoapify_key");
            expect(JSON.parse(value!)).toMatchObject({
              version: 2,
              context: `tenant:${id}:geocoding`,
              aad: "domain:research:geocoding",
              value: "iv.ciphertext",
            });
            expect(await migratePostgres(options)).toEqual([]);
          }
        });
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
    120000,
  );
}
