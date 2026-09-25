import { env } from "cloudflare:workers";
import { beforeAll, expect, it } from "vitest";
import { createApp } from "../src/app";
import { processCrmSyncJobs } from "../src/external-crm/auto-sync";
import type { IdentityUserAdministrator } from "../src/auth/better-auth";
import {
  platformAdministratorAuthenticator,
  agencyMemberAuthenticator,
  agencyAdministratorAuthenticator,
} from "./auth-fixtures";
import { seedTenantAgency } from "./tenant-fixtures";

const migrations = Object.entries(
  import.meta.glob<string>("../../../packages/db/migrations/*.sql", {
    eager: true,
    import: "default",
    query: "?raw",
  }),
).sort(([a], [b]) => a.localeCompare(b));
const genericSolution = {
  format: "savia.solution",
  formatVersion: 1,
  id: "example.projects",
  version: "1.0.0",
  label: "Proyectos",
  description: "Un paquete genérico de prueba.",
  requires: [],
  objects: [
    {
      name: "projects",
      label: "Proyectos",
      description: "",
      config: {
        version: 2,
        fields: {
          name: { type: "Textbox", label: "Nombre", required: true },
        },
        fieldOrder: ["name"],
      },
    },
  ],
};
function identityUserAdministrator(): IdentityUserAdministrator {
  const accounts = new Map<
    string,
    {
      subject: string;
      email: string;
      displayName: string;
      role: "admin" | "user";
      isBanned: boolean;
      twoFactorEnabled: boolean;
    }
  >();
  return {
    issuer: "savia:better-auth",
    async listUsers() {
      return [...accounts.values()];
    },
    async getUser(subject) {
      const account = accounts.get(subject);
      if (!account) throw new Error("Account not found");
      return account;
    },
    async createUser(input) {
      const account = {
        subject: crypto.randomUUID(),
        email: input.email,
        displayName: `${input.firstName} ${input.lastName}`,
        role: "user" as const,
        isBanned: false,
        twoFactorEnabled: false,
      };
      accounts.set(account.subject, account);
      return account;
    },
    async updateUser(subject, input) {
      const account = await this.getUser(
        subject,
        new Request("https://savia.test"),
      );
      return {
        ...account,
        displayName: input.displayName ?? account.displayName,
      };
    },
    async setAccountActive(subject, isActive) {
      const account = await this.getUser(
        subject,
        new Request("https://savia.test"),
      );
      return { ...account, isBanned: !isActive };
    },
    async revokeSessions() {},
    async sendPasswordReset() {},
    async deleteUser(subject) {
      accounts.delete(subject);
    },
  };
}
const app = (userAdministrator?: IdentityUserAdministrator) =>
  createApp(
    env.DB,
    env.DOCUMENTS,
    undefined,
    platformAdministratorAuthenticator(),
    userAdministrator,
  );
const post = (body: unknown, method = "POST") => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});
beforeAll(async () => {
  for (const [path, sql] of migrations) {
    if (path.endsWith("0041_industry_solutions.sql")) {
      await seedTenantAgency(env.DB, 101);
      // Seeded under pre-rename names on purpose: 0064 renames the tables
      // (and rows) to studio_* later in this same chain.
      await env.DB.prepare(
        "INSERT INTO crm_objects(tenant_id,name,label,description,config) VALUES ('agency:101','polizas','Mis pólizas','Personalizadas',?)",
      )
        .bind(
          JSON.stringify({
            version: 2,
            fields: { name: { type: "Textbox", label: "Nombre" } },
            fieldOrder: ["name"],
          }),
        )
        .run();
      await env.DB.prepare(
        "INSERT INTO crm_records(id,tenant_id,object_name,data) VALUES ('legacy-record','agency:101','polizas','{\"name\":\"Póliza existente\"}')",
      ).run();
    }
    for (const statement of sql.split("--> statement-breakpoint")) {
      const normalized = statement
        .replace(/^--.*$/gm, "")
        .replace(/\s+/g, " ")
        .trim();
      if (normalized) await env.DB.exec(normalized);
    }
  }
});
it("adopts existing insurance without rewriting schemas or records", async () => {
  const row = await env.DB.prepare(
    "SELECT version,enabled FROM studio_solution_installations WHERE tenant_id='agency:101' AND id='savia.insurance'",
  ).first();
  expect(row).toEqual({ version: "0.0.0", enabled: 1 });
  const response = await app().request(
    "/v1/dynamic-crm/101/api/records/polizas",
  );
  expect(response.status).toBe(200);
  expect(JSON.stringify(await response.json())).toContain("Póliza existente");
  expect(
    (
      await env.DB.prepare(
        "SELECT label FROM studio_objects WHERE tenant_id='agency:101' AND name='polizas'",
      ).first()
    )?.label,
  ).toBe("Mis pólizas");
});
it("processes CRM jobs for a management-only insurance installation", async () => {
  await seedTenantAgency(env.DB, 102);
  await env.DB.prepare(
    "INSERT INTO identity_principal(id,issuer,subject,email,display_name,created_at,updated_at) VALUES ('crm-sync-test','test','crm-sync-test','sync@example.test','Sync Test','2026-01-01','2026-01-01')",
  ).run();
  await env.DB.prepare(
    "INSERT INTO agency_crm_connections(id,agency_id,created_by_principal_id,provider,nango_connection_id,nango_integration_id,status,created_at,updated_at) VALUES ('crm-sync-connection',102,'crm-sync-test','hubspot','nango-test','hubspot-test','connected','2026-01-01','2026-01-01')",
  ).run();
  await env.DB.prepare(
    "INSERT INTO studio_solution_installations(tenant_id,id,version,manifest) VALUES ('agency:102','savia.insurance-management','1.0.0','{}')",
  ).run();
  await env.DB.prepare(
    "INSERT INTO crm_sync_rules(id,principal_id,tenant_id,provider,connection_id,external_account_id,account_label) VALUES ('crm-sync-rule','crm-sync-test',102,'hubspot','crm-sync-connection','account-test','Test')",
  ).run();
  await env.DB.prepare(
    "INSERT INTO crm_sync_jobs(id,rule_id,customer_id,next_attempt_at) VALUES ('crm-sync-job','crm-sync-rule',999,'2026-01-01T00:00:00.000Z')",
  ).run();

  expect(
    await processCrmSyncJobs(env.DB, {}, { now: new Date("2030-01-01") }),
  ).toEqual({ processed: 1 });
});
it("lists the optional insurance release and accepts a generic package", async () => {
  const api = app(identityUserAdministrator());
  const tenantResponse = await api.request(
    "/v1/tenants",
    post({
      idSlug: "independent-solution-test",
      name: "Organización independiente",
      initialUser: {
        email: "admin@independiente.test",
        firstName: "Ana",
        lastName: "Administradora",
        role: "tenant_admin",
      },
    }),
  );
  expect(tenantResponse.status).toBe(201);
  const tenant = ((await tenantResponse.json()) as any).data;
  const base = `/v1/dynamic-crm/${tenant.id}/api`;
  await api.request(base + "/bootstrap", { method: "POST" });
  expect(
    ((await (await api.request(base + "/objects")).json()) as any).data,
  ).toHaveLength(0);
  const catalog = (await (
    await api.request(base + "/solutions")
  ).json()) as any;
  expect(
    catalog.data.map(
      (solution: { manifest: { id: string } }) => solution.manifest.id,
    ),
  ).toEqual(["savia.insurance-quoter", "savia.insurance-management"]);
  expect(catalog.data[0].manifest.requires).toEqual(["insurance.quotes"]);
  expect(catalog.data[1].manifest.requires).toEqual([]);
  const manifest = genericSolution;
  const installed = await api.request(
    base + "/solutions/install",
    post(manifest),
  );
  expect(installed.status, await installed.clone().text()).toBe(200);
  expect(
    ((await (await api.request(base + "/objects")).json()) as any).data,
  ).toHaveLength(1);
  const project = await api.request(
    base + "/records/projects",
    post({ name: "Proyecto de prueba" }),
  );
  expect(project.status).toBe(201);
  await api.request(
    base + "/solutions/example.projects",
    post({ enabled: false }, "PATCH"),
  );
  expect((await api.request(base + "/records/projects")).status).toBe(404);
  const spec = (await (
    await api.request(base + "/openapi.json")
  ).json()) as any;
  expect(spec.paths["/published/projects"]).toBeUndefined();
  await api.request(
    base + "/solutions/example.projects",
    post({ enabled: true }, "PATCH"),
  );
  expect(
    JSON.stringify(
      await (await api.request(base + "/records/projects")).json(),
    ),
  ).toContain("Proyecto de prueba");
  expect(
    await env.DB.prepare("SELECT id FROM agencies WHERE tenant_id=?")
      .bind(tenant.id)
      .first(),
  ).toBeNull();
  const viewer = createApp(
    env.DB,
    env.DOCUMENTS,
    undefined,
    agencyMemberAuthenticator(),
  );
  expect(
    (await viewer.request(base + "/solutions/install", post(manifest))).status,
  ).toBe(403);
  const foreign = createApp(
    env.DB,
    env.DOCUMENTS,
    undefined,
    agencyAdministratorAuthenticator(),
  );
  expect(
    (await foreign.request(base + "/solutions/example.projects/export")).status,
  ).toBe(403);
});
it("makes the installer available in an empty custom data domain", async () => {
  const api = app();
  await api.request(
    "/v1/data-domains",
    post({ name: "solutiontest", label: "Soluciones" }),
  );
  const base = "/v1/data-domains/solutiontest/api";
  const manifest = {
    ...genericSolution,
    id: "example.inventory",
    label: "Inventario",
    requires: [],
    objects: [
      {
        name: "productos",
        label: "Productos",
        description: "",
        config: {
          version: 2,
          fields: {
            name: { type: "Textbox", label: "Nombre", required: true },
          },
          fieldOrder: ["name"],
        },
      },
    ],
  };
  expect(
    (await api.request(base + "/solutions/install", post(manifest))).status,
  ).toBe(200);
  expect(
    (await api.request(base + "/records/productos", post({ name: "Producto" })))
      .status,
  ).toBe(201);
  expect(
    ((await (await api.request(base + "/objects")).json()) as any).data.map(
      (o: any) => o.name,
    ),
  ).toEqual(["productos"]);
});
