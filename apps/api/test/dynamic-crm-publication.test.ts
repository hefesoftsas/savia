import { seedTenantAgency } from "./tenant-fixtures";
import { env } from "cloudflare:workers";
import { beforeAll, expect, it } from "vitest";
import { createApp } from "../src/app";
import {
  agencyAdministratorAuthenticator,
  agencyMemberAuthenticator,
  platformAdministratorAuthenticator,
} from "./auth-fixtures";
import { makeConfig } from "@savia/crm-shared/metadata";

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
const app = () =>
  createApp(
    env.DB,
    env.DOCUMENTS,
    undefined,
    agencyAdministratorAuthenticator(),
  );
const headers = { "content-type": "application/json" };
async function object(name: string) {
  const definition = {
    name,
    label: "Clientes de prueba",
    description: "Definidos desde CRM",
    config: makeConfig({
      name: { type: "Textbox", label: "Nombre", required: true },
      email: {
        type: "Textbox",
        label: "Correo",
        config: { format: "email", unique: true },
      },
      age: {
        type: "Number",
        label: "Edad",
        config: { integer: true, minimum: 0 },
      },
      status: {
        type: "Dropdown",
        label: "Estado",
        options: [{ value: "new", label: "Nuevo" }],
      },
    }),
  };
  expect(
    (
      await app().request(prefix + "/objects", {
        method: "POST",
        headers,
        body: JSON.stringify(definition),
      })
    ).status,
  ).toBe(201);
  return definition;
}

it("publishes individual typed paths from current agency metadata and refreshes after schema edits", async () => {
  const definition = await object("published_clients");
  const response = await app().request(prefix + "/openapi.json");
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const spec: any = await response.json();
  expect(spec.openapi).toBe("3.1.0");
  expect(spec.paths["/file/{id}/office"].get.operationId).toBe(
    "office_file_metadata",
  );
  expect(
    spec.paths["/file/{id}/revisions"].post.requestBody.content[
      "multipart/form-data"
    ].schema.required,
  ).toEqual(["version", "file"]);
  expect(
    spec.paths["/file/{id}/revisions/{version}/download"].get.responses[200],
  ).toBeTruthy();
  expect(spec.servers).toEqual([{ url: prefix }]);
  expect(spec.paths["/published/published_clients"].post.operationId).toBe(
    "published_clients_create",
  );
  expect(spec.paths["/published/published_clients/{id}"].patch).toBeTruthy();
  const input = spec.components.schemas.published_clients_Create;
  expect(input.required).toContain("name");
  expect(input.properties.name.minLength).toBe(1);
  expect(JSON.stringify(input.properties.email)).toContain('"format":"email"');
  expect(JSON.stringify(input.properties.age)).toContain('"minimum":0');
  expect(input.properties).not.toHaveProperty("id");
  const next = {
    ...definition,
    version: 1,
    config: makeConfig({
      ...definition.config.fields,
      city: { type: "Textbox", label: "Ciudad" },
    }),
  };
  expect(
    (
      await app().request(prefix + "/objects/published_clients", {
        method: "PUT",
        headers,
        body: JSON.stringify(next),
      })
    ).status,
  ).toBe(200);
  const updated: any = await (
    await app().request(prefix + "/openapi.json")
  ).json();
  expect(
    updated.components.schemas.published_clients_Create.properties.city,
  ).toBeDefined();
  expect(
    updated.components.schemas.published_clients_Create["x-crm-schema-version"],
  ).toBe(2);
});

it("executes literal CRUD with existing validation, idempotency, versions and deletion", async () => {
  await object("crud_clients");
  const path = prefix + "/published/crud_clients";
  expect(
    (
      await app().request(path, {
        method: "POST",
        headers,
        body: '{"email":"bad"}',
      })
    ).status,
  ).toBe(422);
  const request = {
    method: "POST",
    headers: { ...headers, "idempotency-key": "published-create" },
    body: JSON.stringify({ name: "Ana", email: "ana@example.test", age: 25 }),
  };
  const created = await app().request(path, request);
  expect(created.status).toBe(201);
  const { data }: any = await created.json();
  expect(
    ((await (await app().request(path, request)).json()) as any).data.id,
  ).toBe(data.id);
  expect(
    ((await (await app().request(path + "/" + data.id)).json()) as any).data
      .name,
  ).toBe("Ana");
  expect(((await (await app().request(path)).json()) as any).total).toBe(1);
  expect(
    (
      await app().request(path + "/" + data.id, {
        method: "PATCH",
        headers,
        body: '{"_version":999,"name":"Otra"}',
      })
    ).status,
  ).toBe(409);
  const updated = await app().request(path + "/" + data.id, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ _version: data._version, name: "Ana María" }),
  });
  expect(updated.status).toBe(200);
  const version = ((await updated.json()) as any).data._version;
  expect(
    (
      await app().request(path + "/" + data.id + "?version=" + version, {
        method: "DELETE",
      })
    ).status,
  ).toBe(200);
  expect((await app().request(path + "/" + data.id)).status).toBe(404);
  expect((await app().request(prefix + "/published/unknown")).status).toBe(404);
  expect(
    (await app().request(path + "/" + data.id + "/restore", { method: "POST" }))
      .status,
  ).toBe(404);
});

it("does not expose another tenant's schemas and protects documentation with CRM permissions", async () => {
  await object("private_clients");
  expect(
    (await app().request("/v1/dynamic-crm/202/api/openapi.json")).status,
  ).toBe(403);
  const viewer = createApp(
    env.DB,
    env.DOCUMENTS,
    undefined,
    agencyMemberAuthenticator(),
  );
  expect((await viewer.request(prefix + "/openapi.json")).status).toBe(403);
  expect((await viewer.request(prefix + "/docs")).status).toBe(403);
  const platform = createApp(
    env.DB,
    env.DOCUMENTS,
    undefined,
    platformAdministratorAuthenticator(),
  );
  const other: any = await (
    await platform.request("/v1/dynamic-crm/202/api/openapi.json")
  ).json();
  expect(other.paths).not.toHaveProperty("/published/private_clients");
  const docs = await app().request(prefix + "/docs");
  expect(docs.status).toBe(200);
  expect(docs.headers.get("content-type")).toContain("text/html");
  const html = await docs.text();
  expect(html).toContain("Scalar");
  expect(html).toContain("http://localhost/v1/dynamic-crm/101/api");
  expect(html).toContain("/published/private_clients");
  expect(html).not.toContain("{object}");
});

it("renders untrusted metadata as document content without opening HTML script tags", async () => {
  const definition = await object("escaped_clients");
  const unsafe = "</script><script>alert('metadata')</script>";
  expect(
    (
      await app().request(prefix + "/objects/escaped_clients", {
        method: "PUT",
        headers,
        body: JSON.stringify({ ...definition, label: unsafe, version: 1 }),
      })
    ).status,
  ).toBe(200);
  const html = await (await app().request(prefix + "/docs")).text();
  expect(html).not.toContain(unsafe);
});
