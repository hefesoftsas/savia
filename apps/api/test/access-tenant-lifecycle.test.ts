import { env } from "cloudflare:workers";
import { beforeAll, expect, it } from "vitest";

const baseline = Object.entries(
  import.meta.glob<string>(
    "../../../packages/db/migrations/000{1_initial,2_bootstrap}.sql",
    {
      eager: true,
      import: "default",
      query: "?raw",
    },
  ),
).sort(([a], [b]) => a.localeCompare(b));

beforeAll(async () => {
  expect(baseline).toHaveLength(2);
  for (const [, sql] of baseline) {
    for (const statement of sql.split("--> statement-breakpoint")) {
      const normalized = statement
        .replace(/^--.*$/gm, "")
        .replace(/\s+/g, " ")
        .trim();
      if (normalized) await env.DB.exec(normalized);
    }
  }
});

const count = async (table: string, scope: string) =>
  env.DB.prepare(`SELECT count(*) AS count FROM ${table} WHERE scope=?`)
    .bind(scope)
    .first<number>("count");

it("creates tenant roles and revokes tenant permissions while preserving audit and revision history", async () => {
  await env.DB.prepare(
    "INSERT INTO tenants(id,id_slug,name,created_at,updated_at,kind) VALUES(501,'lifecycle-501','Lifecycle 501','2026-09-29','2026-09-29','commercial')",
  ).run();
  const scope = "tenant:501";
  expect(await count("access_roles", scope)).toBe(4);

  await env.DB.prepare(
    "INSERT INTO identity_principal(id,issuer,subject,email,display_name,created_at,updated_at) VALUES('lifecycle-user','savia:better-auth','lifecycle-user','test@example.test','Test','2026-09-29','2026-09-29')",
  ).run();
  await env.DB.prepare(
    "INSERT INTO identity_tenant_membership(id,principal_id,tenant_id,role,is_active,created_at,updated_at) VALUES('lifecycle-membership','lifecycle-user',501,'viewer',1,'2026-09-29','2026-09-29')",
  ).run();
  await env.DB.prepare(
    "INSERT INTO access_roles(id,scope,name,label) VALUES('custom',?,'custom','Custom')",
  )
    .bind(scope)
    .run();
  await env.DB.prepare(
    "INSERT INTO access_grants(id,scope,role_id,resource,action,predicate,fields) VALUES('grant-501',?,'custom','collection:contacts','read','{\"all\":true}','[]')",
  )
    .bind(scope)
    .run();
  await env.DB.prepare(
    "INSERT INTO access_assignments(scope,principal_id,role_id) VALUES(?,'lifecycle-user','custom')",
  )
    .bind(scope)
    .run();
  await env.DB.prepare(
    "INSERT INTO access_audit(id,scope,actor_id,action,target_id) VALUES('audit-501',?,'lifecycle-user','role.create','custom')",
  )
    .bind(scope)
    .run();

  const beforeDelete = await env.DB.prepare(
    "SELECT revision FROM access_revisions WHERE scope=?",
  )
    .bind(scope)
    .first<number>("revision");
  await env.DB.prepare("DELETE FROM tenants WHERE id=501").run();

  for (const table of ["access_roles", "access_grants", "access_assignments"])
    expect(await count(table, scope)).toBe(0);
  expect(
    await env.DB.prepare(
      "SELECT count(*) AS count FROM access_audit WHERE scope=?",
    )
      .bind(scope)
      .first<number>("count"),
  ).toBe(1);
  expect(
    await env.DB.prepare("SELECT revision FROM access_revisions WHERE scope=?")
      .bind(scope)
      .first<number>("revision"),
  ).toBeGreaterThan(beforeDelete!);

  await env.DB.prepare(
    "INSERT INTO tenants(id,id_slug,name,created_at,updated_at,kind) VALUES(501,'lifecycle-501','Lifecycle 501','2026-09-29','2026-09-29','commercial')",
  ).run();
  expect(await count("access_roles", scope)).toBe(4);
  expect(await count("access_assignments", scope)).toBe(0);
  expect(
    (await env.DB.prepare("PRAGMA foreign_key_check").all()).results,
  ).toEqual([]);
});
