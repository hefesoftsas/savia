import { env } from "cloudflare:workers";
import { makeConfig } from "@savia/studio-shared/metadata";
import { createTestApp } from "./test-app";
import { seedTenantAgency } from "./tenant-fixtures";
import { agencyMemberAuthenticator } from "./auth-fixtures";
import type { AppActor } from "../src/auth/types";

export type FixtureRole =
  "platform_admin" | "tenant_admin" | "agency_admin" | "operator" | "viewer";
const migrations = Object.entries(
  import.meta.glob<string>("../../../packages/db/migrations/*.sql", {
    eager: true,
    import: "default",
    query: "?raw",
  }),
).sort(([a], [b]) => a.localeCompare(b));
export async function createAccessFixture() {
  for (const [, sql] of migrations)
    for (const statement of sql.split("--> statement-breakpoint")) {
      const normalized = statement
        .replace(/^--.*$/gm, "")
        .replace(/\s+/g, " ")
        .trim();
      if (normalized) await env.DB.exec(normalized);
    }
  await seedTenantAgency(env.DB, 101);
  await seedTenantAgency(env.DB, 102);
  const principalId = (role: FixtureRole) => "acl-" + role;
  const actor = async (
    role: FixtureRole,
    tenantId = 101,
  ): Promise<AppActor> => {
    const base = await agencyMemberAuthenticator().authenticate(
      new Request("https://savia.test"),
      env.DB,
    );
    base.principal = {
      ...base.principal,
      id: principalId(role),
      subject: principalId(role),
    };
    base.globalRoles = role === "platform_admin" ? ["platform_admin"] : [];
    base.memberships =
      role === "platform_admin"
        ? []
        : [
            {
              ...base.memberships[0]!,
              id: "acl-membership-" + role,
              principalId: principalId(role),
              agencyId: tenantId,
              tenantId,
              role,
            },
          ];
    return base;
  };
  for (const role of [
    "platform_admin",
    "tenant_admin",
    "agency_admin",
    "operator",
    "viewer",
  ] as FixtureRole[]) {
    const a = await actor(role);
    await env.DB.prepare(
      "INSERT INTO identity_principal(id,issuer,subject,email,display_name,is_active,created_at,updated_at) VALUES (?,?,?,?,?,1,?,?)",
    )
      .bind(
        a.principal.id,
        a.principal.issuer,
        a.principal.subject,
        role + "@acl.test",
        role,
        a.principal.createdAt,
        a.principal.updatedAt,
      )
      .run();
    if (role === "platform_admin")
      await env.DB.prepare(
        "INSERT INTO identity_global_role(principal_id,role,created_at) VALUES (?,'platform_admin',?)",
      )
        .bind(a.principal.id, a.principal.createdAt)
        .run();
    else
      await env.DB.prepare(
        "INSERT INTO identity_tenant_membership(id,principal_id,tenant_id,role,is_active,created_at,updated_at) VALUES (?,?,101,?,1,?,?)",
      )
        .bind(
          "acl-membership-" + role,
          a.principal.id,
          role,
          a.principal.createdAt,
          a.principal.updatedAt,
        )
        .run();
  }
  const request = async (
    role: FixtureRole,
    tenantId: number,
    path: string,
    init?: RequestInit,
  ) => {
    const a = await actor(role, tenantId);
    return createTestApp({
      documents: env.DOCUMENTS,
      auth: { authenticate: async () => a },
    }).request(path, init);
  };
  const headers = { "content-type": "application/json" };
  for (const id of [101, 102]) {
    const response = await request(
      "platform_admin",
      id,
      `/v1/dynamic-crm/${id}/api/objects`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          name: "acl_contacts",
          label: "ACL contacts",
          config: makeConfig({
            name: { type: "Textbox", label: "Name" },
            commission: { type: "Number", label: "Commission" },
          }),
        }),
      },
    );
    if (response.status !== 201)
      throw new Error(
        "ACL fixture object: " +
          response.status +
          " " +
          (await response.text()),
      );
    const created = await request(
      "platform_admin",
      id,
      `/v1/dynamic-crm/${id}/api/records/acl_contacts`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ name: "Tenant " + id, commission: id }),
      },
    );
    if (created.status !== 201)
      throw new Error("ACL fixture record: " + (await created.text()));
  }
  await env.DB.prepare(
    "INSERT INTO crm_data_domains(id,label,created_by) VALUES ('acl_private','ACL private',?)",
  )
    .bind(principalId("platform_admin"))
    .run();
  return { db: env.DB, actor, principalId, request, dispose: async () => {} };
}
