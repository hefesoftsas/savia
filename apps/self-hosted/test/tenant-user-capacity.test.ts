import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { migratePostgres } from "../src/postgres/migrations";
import { postgresTestUrl, withPostgresFixture } from "./postgres-fixture";

(postgresTestUrl ? describe : describe.skip)(
  "PostgreSQL tenant user capacity",
  () => {
    it("serializes concurrent admissions and blocks reactivation at capacity", async () => {
      await withPostgresFixture(async (db, connectionString) => {
        await migratePostgres({
          connectionString,
          schema: "savia_core",
          directory: resolve("../../packages/db/postgres"),
          seed: false,
        });
        await db
          .prepare(
            "INSERT INTO tenants(id,id_slug,name,kind,is_active,created_at,updated_at) VALUES(901,'capacity','Capacity','commercial',1,'now','now')",
          )
          .run();
        await db
          .prepare(
            "INSERT INTO tenant_user_limits(tenant_id,max_active_users) VALUES(901,1)",
          )
          .run();
        for (const id of ["capacity-a", "capacity-b", "capacity-inactive"])
          await db
            .prepare(
              "INSERT INTO identity_principal(id,issuer,subject,email,display_name,is_active,created_at,updated_at) VALUES(?,'test',?,?,?,?,'now','now')",
            )
            .bind(
              id,
              id,
              `${id}@test.example`,
              id,
              id.endsWith("inactive") ? 0 : 1,
            )
            .run();
        const admit = (id: string) =>
          db
            .prepare(
              "INSERT INTO identity_tenant_membership(id,principal_id,tenant_id,role,is_active,created_at,updated_at) VALUES(?,?,901,'viewer',1,'now','now')",
            )
            .bind(id, id)
            .run();
        const results = await Promise.allSettled([
          admit("capacity-a"),
          admit("capacity-b"),
        ]);
        expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
        expect(
          String(
            (
              results.find(
                (r) => r.status === "rejected",
              ) as PromiseRejectedResult
            ).reason,
          ),
        ).toContain("TENANT_ACTIVE_USER_LIMIT_REACHED");
        await admit("capacity-inactive");
        await expect(
          db
            .prepare(
              "UPDATE identity_principal SET is_active=1 WHERE id='capacity-inactive'",
            )
            .run(),
        ).rejects.toThrow("TENANT_ACTIVE_USER_LIMIT_REACHED");
        await db
          .prepare(
            "UPDATE tenant_user_limits SET max_active_users=NULL WHERE tenant_id=901",
          )
          .run();
        await db
          .prepare(
            "UPDATE identity_principal SET is_active=1 WHERE id='capacity-inactive'",
          )
          .run();
        expect(
          await db
            .prepare(
              "SELECT COUNT(*) AS n FROM identity_tenant_membership m JOIN identity_principal p ON p.id=m.principal_id WHERE m.tenant_id=901 AND p.is_active=1",
            )
            .first("n"),
        ).toBe(2);
      });
    }, 120000);
  },
);
