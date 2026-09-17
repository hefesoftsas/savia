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
