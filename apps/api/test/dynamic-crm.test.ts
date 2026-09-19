import { makeConfig } from "@savia/crm-shared/metadata";
import { seedTenantAgency } from "./tenant-fixtures";
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { createTestApp } from "./test-app";
import {
  agencyAdministratorAuthenticator,
  agencyMemberAuthenticator,
  platformAdministratorAuthenticator,
} from "./auth-fixtures";
import { AuthenticationError } from "../src/auth/types";
import { runScheduledWorkflows } from "../src/workflows";

const migrations = Object.entries(
  import.meta.glob<string>("../../../packages/db/migrations/*.sql", {
    eager: true,
    import: "default",
    query: "?raw",
  }),
);
beforeAll(async () => {
  for (const [, sql] of migrations.sort(([a], [b]) => a.localeCompare(b)))
    for (const statement of sql.split("--> statement-breakpoint")) {
      const normalized = statement
        .replace(/^--.*$/gm, "")
        .replace(/\s+/g, " ")
        .trim();
      if (normalized) await env.DB.exec(normalized);
    }
  await seedTenantAgency(env.DB, 101);
  await seedTenantAgency(env.DB, 202);
});
const prefix = "/v1/dynamic-crm/101/api";
const admin = () =>
  createApp(
    env.DB,
    env.DOCUMENTS,
    undefined,
    agencyAdministratorAuthenticator(),
  );
it("runs general-domain workflows with current persisted owner permissions", async () => {
  const app = createApp(
    env.DB,
    env.DOCUMENTS,
    undefined,
    platformAdministratorAuthenticator(),
  );
  const base = "/v1/data-domains/platform/api";
  const headers = { "content-type": "application/json" };
  const draftResponse = await app.request(base + "/workflows", {
    method: "POST",
    headers,
    body: JSON.stringify({
      name: "General process",
      definition: {
        trigger: { type: "manual" },
        nodes: [{ id: "done", type: "transform", values: { result: "ok" } }],
      },
    }),
  });
  expect(draftResponse.status).toBe(201);
  const reference = await app.request(base + "/openapi.json");
  expect(reference.status).toBe(200);
  expect(
    ((await reference.json()) as any).paths["/workflows/{id}/publish"].post
      .requestBody.content["application/json"].schema.properties.revision.type,
  ).toBe("integer");
  const { data: draft } = (await draftResponse.json()) as any;
  expect(
    (
      await app.request(`${base}/workflows/${draft.id}/publish`, {
        method: "POST",
        headers,
        body: JSON.stringify({ revision: draft.revision }),
      })
    ).status,
  ).toBe(200);
  await env.DB.prepare(
    "INSERT INTO identity_principal(id,issuer,subject,email,display_name,is_active,created_at,updated_at) VALUES ('test-platform-admin','savia:test','workflow-owner','workflow@example.test','Workflow owner',1,'2026-01-01','2026-01-01') ON CONFLICT(id) DO NOTHING",
  ).run();
  await env.DB.prepare(
    "INSERT OR IGNORE INTO identity_global_role(principal_id,role,created_at) VALUES ('test-platform-admin','platform_admin','2026-01-01')",
  ).run();
  const start = async (key: string) =>
    (await (
      await app.request(`${base}/workflows/${draft.id}/start`, {
        method: "POST",
        headers,
        body: JSON.stringify({ key, data: {} }),
      })
    ).json()) as any;
  const first = await start("authorized");
  await runScheduledWorkflows(env.DB);
  expect(
    (
      (await (
        await app.request(`${base}/workflow-executions/${first.data.id}`)
      ).json()) as any
    ).data.status,
  ).toBe("completed");
  const second = await start("revoked");
  await env.DB.prepare(
    "UPDATE identity_principal SET is_active=0 WHERE id='test-platform-admin'",
  ).run();
  await runScheduledWorkflows(env.DB);
  expect(
    (
      (await (
        await app.request(`${base}/workflow-executions/${second.data.id}`)
      ).json()) as any
    ).data.status,
  ).toBe("blocked");
  await env.DB.prepare(
    "UPDATE identity_principal SET is_active=1 WHERE id='test-platform-admin'",
  ).run();
  expect(
    (await admin().request(prefix + `/workflows/${draft.id}`)).status,
  ).toBe(404);
});
describe("CRM inside Savia", () => {
  it("rejects anonymous, viewer and foreign agency requests", async () => {
    const anonymous = createApp(env.DB, env.DOCUMENTS, undefined, {
      authenticate: async () => {
        throw new AuthenticationError("AUTHENTICATION_REQUIRED", "Sign in");
      },
    });
    expect((await anonymous.request(prefix + "/objects")).status).toBe(401);
    const viewer = createApp(
      env.DB,
      env.DOCUMENTS,
      undefined,
      agencyMemberAuthenticator(),
    );
    expect((await viewer.request(prefix + "/objects")).status).toBe(403);
    expect(
      (await admin().request("/v1/dynamic-crm/202/api/objects")).status,
    ).toBe(403);
  });
  it("starts without industry templates and isolates tenant data", async () => {
    const app = admin();
    expect(
      (await app.request(prefix + "/bootstrap", { method: "POST" })).status,
    ).toBe(200);
    const objects = (await (await app.request(prefix + "/objects")).json()) as {
      data: { count: number }[];
    };
    expect(objects.data).toHaveLength(0);
    expect(objects.data.every((o) => o.count === 0)).toBe(true);
    const other = createApp(
      env.DB,
      env.DOCUMENTS,
      undefined,
      platformAdministratorAuthenticator(),
    );
    const result = await other.request("/v1/dynamic-crm/202/api/objects");
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ data: [], menuLayout: null });
  });
});

it("persists records across requests, checks versions, and isolates exports and attachments", async () => {
  const app = admin();
  await app.request(prefix + "/bootstrap", { method: "POST" });
  const headers = {
    "content-type": "application/json",
    "idempotency-key": "integration-record",
  };
  await app.request(prefix + "/objects", {
    method: "POST",
    headers,
    body: JSON.stringify({
      name: "account",
      label: "Empresas",
      config: {
        version: 2,
        fields: { name: { type: "Textbox", label: "Nombre", required: true } },
        fieldOrder: ["name"],
      },
    }),
  });
  const response = await app.request(prefix + "/records/account", {
    method: "POST",
    headers,
    body: JSON.stringify({ name: "Prueba de integración" }),
  });
  expect(response.status).toBe(201);
  const created = (await response.json()) as {
    data: { id: string; _version: number };
  };
  const id = created.data.id;
  const repeated = await app.request(prefix + "/records/account", {
    method: "POST",
    headers,
    body: JSON.stringify({ name: "Prueba de integración" }),
  });
  expect(((await repeated.json()) as { data: { id: string } }).data.id).toBe(
    id,
  );
  const persisted = await admin().request(prefix + "/records/account/" + id);
  expect(
    ((await persisted.json()) as { data: { name: string } }).data.name,
  ).toBe("Prueba de integración");
  const stale = await app.request(prefix + "/records/account/" + id, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ name: "Cambio", _version: 999 }),
  });
  expect(stale.status).toBe(409);
  const form = new FormData();
  form.append(
    "file",
    new File(["contenido de prueba"], "prueba.txt", { type: "text/plain" }),
  );
  const upload = await app.request(prefix + "/files/account/" + id, {
    method: "POST",
    body: form,
  });
  expect(upload.status).toBe(201);
  const file = (await upload.json()) as { data: { id: string } };
  const download = await app.request(
    prefix + "/file/" + file.data.id + "/download",
  );
  expect(await download.text()).toBe("contenido de prueba");
  const other = createApp(
    env.DB,
    env.DOCUMENTS,
    undefined,
    platformAdministratorAuthenticator(),
  );
  expect(
    (await other.request("/v1/dynamic-crm/202/api/records/account/" + id))
      .status,
  ).toBe(404);
  expect(
    (
      await other.request(
        "/v1/dynamic-crm/202/api/file/" + file.data.id + "/download",
      )
    ).status,
  ).toBe(404);
  const csv = await app.request(prefix + "/export/account");
  expect(csv.headers.get("content-type")).toContain("text/csv");
  expect(await csv.text()).toContain("Prueba de integración");
});

it("encrypts integration credentials using the configured Savia CRM key", async () => {
  const app = createTestApp({
    auth: agencyAdministratorAuthenticator(),
    documents: env.DOCUMENTS,
    crmIntegrationKey: "integration-test-key-with-at-least-32-characters",
  });
  const headers = { "content-type": "application/json" };
  const created = await app.request(prefix + "/integrations", {
    method: "POST",
    headers,
    body: JSON.stringify({
      document: {
        openapi: "3.0.3",
        info: { title: "Integration test", version: "1" },
        paths: {},
      },
    }),
  });
  expect(created.status).toBe(201);
  const {
    data: { id },
  } = (await created.json()) as { data: { id: string } };
  const saved = await app.request(prefix + `/integrations/${id}/connection`, {
    method: "PUT",
    headers,
    body: JSON.stringify({
      mode: "external",
      baseUrl: "https://api.github.com",
      authType: "bearer",
      secret: "test-private-value",
    }),
  });
  expect(saved.status).toBe(200);
  expect(await saved.text()).not.toContain("test-private-value");
  const row = await env.DB.prepare(
    "SELECT encrypted_secret FROM crm_integrations WHERE id=?",
  )
    .bind(id)
    .first<{ encrypted_secret: string }>();
  expect(row?.encrypted_secret).toBeTruthy();
  expect(row?.encrypted_secret).not.toContain("test-private-value");
});

it("allows members to discover only shared CRM collections and rejects writes and foreign tenants", async () => {
  const manager = admin();
  for (const name of ["shared_contacts", "private_contacts"]) {
    await manager.request(prefix + "/objects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name,
        label: name,
        config: {
          version: 2,
          fields: { name: { type: "Textbox", label: "Name" } },
          fieldOrder: ["name"],
        },
      }),
    });
  }
  await env.DB.prepare(
    "INSERT INTO crm_collection_bindings(tenant_id,object_name,source_id,resource,config) VALUES(?,?,?,?,?)",
  )
    .bind(
      "agency:101",
      "shared_contacts",
      "hubspot",
      "contacts",
      JSON.stringify({
        kind: "crm",
        provider: "hubspot",
        resource: "contacts",
        accessScope: "tenant",
        principalId: "owner",
        connectionId: "shared-connection",
        accountId: "123",
      }),
    )
    .run();
  const member = createApp(
    env.DB,
    env.DOCUMENTS,
    undefined,
    agencyMemberAuthenticator(),
  );
  const response = await member.request(prefix + "/objects");
  expect(response.status).toBe(200);
  expect(((await response.json()) as any).data.map((x: any) => x.name)).toEqual(
    ["shared_contacts"],
  );
  expect(
    (await member.request(prefix + "/bootstrap", { method: "POST" })).status,
  ).toBe(200);
  expect(
    (await member.request(prefix + "/objects/private_contacts")).status,
  ).toBe(403);
  expect(
    (
      await member.request(prefix + "/records/shared_contacts", {
        method: "POST",
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await member.request(prefix + "/crm-workspace/install", {
        method: "POST",
      })
    ).status,
  ).toBe(403);
  expect((await member.request("/v1/dynamic-crm/202/api/objects")).status).toBe(
    403,
  );
});

describe("local synchronization transport", () => {
  it("preserves authentication, stable IDs and conflict master data", async () => {
    const app = admin();
    expect(
      (await app.request("/v1/dynamic-crm/202/api/local-sync/manifest")).status,
    ).toBe(403);
    const manifest = await app.request(prefix + "/local-sync/manifest");
    expect(manifest.status).toBe(200);
    const objects: any = await (await app.request(prefix + "/objects")).json();
    const name = objects.data.find(
      (o: any) => !o.config.studio?.collection,
    )?.name;
    expect(name).toBeTruthy();
    const response = await app.request(prefix + "/local-sync/push/" + name, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mutationId: "missing-sync-master",
        action: "update",
        id: "missing-record",
        baseVersion: 1,
        data: {},
      }),
    });
    expect(response.status).toBe(409);
    const conflict: any = await response.json();
    expect(conflict).toHaveProperty("master", null);
    expect(conflict).toHaveProperty("data", null);
  });
});

it("preserves conflict master through the platform data-domain transport", async () => {
  const app = createApp(
    env.DB,
    env.DOCUMENTS,
    undefined,
    platformAdministratorAuthenticator(),
  );
  const base = "/v1/data-domains/platform/api";
  const object = await app.request(base + "/objects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "sync_platform",
      label: "Sync",
      config: makeConfig({ name: { type: "Textbox", label: "Name" } }),
    }),
  });
  expect(object.status, await object.text()).toBe(201);
  const response = await app.request(base + "/local-sync/push/sync_platform", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mutationId: "platform-sync-conflict",
      action: "update",
      id: "missing",
      baseVersion: 1,
      data: {},
    }),
  });
  expect(response.status).toBe(409);
  expect(await response.json()).toHaveProperty("master", null);
});

it("forwards principal binding through both authenticated synchronization gateways", async () => {
  const app = createApp(
    env.DB,
    env.DOCUMENTS,
    undefined,
    platformAdministratorAuthenticator(),
  );
  for (const base of [
    "/v1/data-domains/platform/api",
    "/v1/dynamic-crm/101/api",
  ]) {
    const response = await app.request(base + "/local-sync/manifest", {
      headers: { "X-Savia-Sync-Principal": "wrong-principal" },
    });
    expect(response.status).toBe(403);
  }
});
