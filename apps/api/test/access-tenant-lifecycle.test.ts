import { env } from "cloudflare:workers";
import { beforeAll, expect, it } from "vitest";

const migrations = Object.entries(
  import.meta.glob<string>("../../../packages/db/migrations/*.sql", {
    eager: true,
    import: "default",
    query: "?raw",
  }),
).sort(([a], [b]) => a.localeCompare(b));

async function apply(sql: string) {
  for (const statement of sql.split("--> statement-breakpoint")) {
    const normalized = statement
      .replace(/^--.*$/gm, "")
      .replace(/\s+/g, " ")
      .trim();
    if (normalized) await env.DB.exec(normalized);
  }
}

async function tenant(id: number) {
  await env.DB.prepare(
    "INSERT INTO tenants(id,id_slug,name,created_at,updated_at) VALUES(?,?,?,'2026-09-19','2026-09-19')",
  )
    .bind(id, `lifecycle-${id}`, `Lifecycle ${id}`)
    .run();
}

async function count(table: string, scope: string) {
  return env.DB.prepare(`SELECT count(*) AS count FROM ${table} WHERE scope=?`)
    .bind(scope)
    .first<number>("count");
}

beforeAll(async () => {
  for (const [path, sql] of migrations) {
    if (!path.endsWith("0057_access_tenant_lifecycle.sql")) await apply(sql);
  }
});

it("repairs orphan policies and clears deleted tenant permissions without losing audit or revision history", async () => {
  await tenant(501);
  await tenant(502);
  await env.DB.exec(
    "INSERT INTO identity_principal(id,issuer,subject,email,display_name,created_at,updated_at) VALUES('lifecycle-user','test','lifecycle-user','test@example.test','Test','2026-09-19','2026-09-19')",
  );
  for (const id of [501, 502]) {
    const scope = `tenant:${id}`;
    await env.DB.prepare(
      "INSERT INTO access_roles(id,scope,name,label) VALUES('custom',?,'custom','Custom')",
    )
      .bind(scope)
      .run();
    await env.DB.prepare(
      "INSERT INTO access_grants(id,scope,role_id,resource,action,predicate,fields) VALUES(?,?,'custom','collection:contacts','read','{\"all\":true}','[]')",
    )
      .bind(`grant-${id}`, scope)
      .run();
    await env.DB.prepare(
      "INSERT INTO access_assignments(scope,principal_id,role_id) VALUES(?,'lifecycle-user','custom')",
    )
      .bind(scope)
      .run();
    await env.DB.prepare(
      "INSERT INTO access_audit(id,scope,actor_id,action,target_id) VALUES(?,?,'lifecycle-user','role.create','custom')",
    )
      .bind(`audit-${id}`, scope)
      .run();
    await env.DB.prepare("UPDATE access_revisions SET revision=7 WHERE scope=?")
      .bind(scope)
      .run();
  }
  // Reproduce state left behind by the previous tenant deletion behavior.
  await env.DB.exec("DELETE FROM tenants WHERE id=501");
  expect(await count("access_roles", "tenant:501")).toBe(5);
  const repair = migrations.find(([path]) =>
    path.endsWith("0057_access_tenant_lifecycle.sql"),
  );
  expect(repair).toBeDefined();
  await apply(repair![1]);

  for (const table of ["access_roles", "access_grants", "access_assignments"]) {
    expect(await count(table, "tenant:501")).toBe(0);
  }
  expect(await count("access_roles", "tenant:502")).toBe(5);
  expect(await count("access_grants", "tenant:502")).toBe(1);
  expect(await count("access_assignments", "tenant:502")).toBe(1);

  await env.DB.exec("DELETE FROM tenants WHERE id=502");
  for (const id of [501, 502]) {
    const scope = `tenant:${id}`;
    for (const table of [
      "access_roles",
      "access_grants",
      "access_assignments",
    ]) {
      expect(await count(table, scope)).toBe(0);
    }
    expect(await count("access_audit", scope)).toBe(1);
    expect(
      await env.DB.prepare(
        "SELECT revision FROM access_revisions WHERE scope=?",
      )
        .bind(scope)
        .first("revision"),
    ).toBe(8);
    await tenant(id);
    expect(await count("access_roles", scope)).toBe(4);
    expect(await count("access_assignments", scope)).toBe(0);
  }
});
