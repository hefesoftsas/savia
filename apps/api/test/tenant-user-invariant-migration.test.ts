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

async function applyBaseline() {
  expect(baseline.map(([path]) => path.split("/").at(-1))).toEqual([
    "0001_initial.sql",
    "0002_bootstrap.sql",
  ]);
  for (const [, sql] of baseline) {
    for (const statement of sql.split("--> statement-breakpoint")) {
      const normalized = statement
        .replace(/^--.*$/gm, "")
        .replace(/\s+/g, " ")
        .trim();
      if (normalized) await env.DB.exec(normalized);
    }
  }
}

beforeAll(applyBaseline);

it("starts with a platform tenant and grants new tenant members their built-in role", async () => {
  expect(
    await env.DB.prepare("SELECT id,kind FROM tenants WHERE id=0").first(),
  ).toEqual({ id: 0, kind: "platform" });

  await env.DB.prepare(
    "INSERT INTO tenants(id,id_slug,name,is_active,created_at,updated_at,kind) VALUES(101,'membership-test','Membership test',1,'2026-09-29','2026-09-29','commercial')",
  ).run();
  await env.DB.prepare(
    "INSERT INTO identity_principal(id,issuer,subject,email,display_name,created_at,updated_at) VALUES('membership-test','savia:better-auth','membership-test','member@example.test','Test Member','2026-09-29','2026-09-29')",
  ).run();
  await env.DB.prepare(
    "INSERT INTO identity_tenant_membership(id,principal_id,tenant_id,role,is_active,created_at,updated_at) VALUES('membership-test','membership-test',101,'viewer',1,'2026-09-29','2026-09-29')",
  ).run();

  expect(
    await env.DB.prepare(
      "SELECT a.scope,r.name FROM access_assignments a JOIN access_roles r ON r.scope=a.scope AND r.id=a.role_id WHERE a.principal_id='membership-test'",
    ).first(),
  ).toEqual({ scope: "tenant:101", name: "viewer" });
  await expect(
    env.DB.prepare(
      "INSERT INTO identity_tenant_membership(id,principal_id,tenant_id,role,is_active,created_at,updated_at) VALUES('membership-test-2','membership-test',101,'operator',1,'2026-09-29','2026-09-29')",
    ).run(),
  ).rejects.toThrow();
  expect(
    (await env.DB.prepare("PRAGMA foreign_key_check").all()).results,
  ).toEqual([]);
});
