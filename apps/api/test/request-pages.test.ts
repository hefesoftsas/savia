import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createTestApp } from "./test-app";
import {
  platformAdministratorAuthenticator,
  agencyMemberAuthenticator,
} from "./auth-fixtures";
import type { Authenticator } from "../src/auth/types";
import { generateRequestPage } from "@savia/crm-shared/request-page";
const migrations = Object.entries(
  import.meta.glob<string>("../../../packages/db/migrations/*.sql", {
    eager: true,
    import: "default",
    query: "?raw",
  }),
)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([, sql]) => sql);
const document = {
  openapi: "3.1.0",
  paths: {
    "/api/flows/test-request/runs": {
      post: {
        operationId: "execute_test-request",
        summary: "Test request",
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  input: {
                    type: "object",
                    properties: { plate: { type: "string", title: "Placa" } },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
};
const object = generateRequestPage(document, {
  name: "generated",
  label: "Generated",
  operationIds: ["test-request"],
});
const provider = vi.fn(async (request: Request) => {
  const path = new URL(request.url).pathname;
  if (path === "/api/openapi.json") return Response.json(document);
  if (path === "/api/flows/test-request")
    return Response.json({
      id: "test-request",
      name: "Test",
      kind: "request",
      steps: [],
    });
  if (path === "/api/flows/test-request/runs")
    return Response.json({
      id: crypto.randomUUID(),
      flowId: "test-request",
      mode: "mock",
      status: "success",
      createdAt: new Date().toISOString(),
      versionId: null,
      steps: [],
      result: { simulated: true },
    });
  throw new Error("Unexpected path");
});
function appFor(auth: Authenticator = platformAdministratorAuthenticator()) {
  return createTestApp({ auth, saviaRequestService: { fetch: provider } });
}
const input = () => ({
  id: crypto.randomUUID(),
  domainId: "platform",
  pageName: "generated",
  actionId: "test-request",
  mode: "mock",
  values: { plate: "TESTCAR" },
});
const post = (app: ReturnType<typeof appFor>, body: unknown) =>
  app.request("/v1/request-pages/runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
beforeAll(async () => {
  for (const sql of migrations)
    for (const statement of sql
      .split("--> statement-breakpoint")
      .map((v) =>
        v
          .replace(/^--.*$/gm, "")
          .replace(/\s+/g, " ")
          .trim(),
      )
      .filter(Boolean))
      await env.DB.exec(statement);
  await env.DB.prepare(
    "INSERT INTO crm_objects(tenant_id,name,label,description,config) VALUES(?,?,?,?,?)",
  )
    .bind(
      "domain:platform",
      object.name,
      object.label,
      object.description,
      JSON.stringify(object.config),
    )
    .run();
});
describe("generated request pages", () => {
  it("persists results and does not repeat a provider call on replay or history reads", async () => {
    const app = appFor(),
      body = input();
    provider.mockClear();
    const response = await post(app, body);
    expect(response.status).toBe(200);
    const run = (await response.json()) as any;
    expect(run.status).toBe("complete");
    expect(run.values.plate).toBe("TESTCAR");
    expect((await post(app, body)).status).toBe(200);
    const history = await app.request(
      "/v1/request-pages/runs?domainId=platform&pageName=generated",
    );
    expect(
      ((await history.json()) as any).data.some((r: any) => r.id === body.id),
    ).toBe(true);
    expect(
      provider.mock.calls.filter(([r]) => r.method === "POST"),
    ).toHaveLength(1);
    expect(
      (await post(app, { ...body, values: { plate: "CHANGED" } })).status,
    ).toBe(409);
  });
  it("rejects undeclared actions and invalid forms before contacting providers", async () => {
    provider.mockClear();
    expect(
      (await post(appFor(), { ...input(), actionId: "arbitrary-flow" })).status,
    ).toBe(404);
    expect(
      (await post(appFor(), { ...input(), values: { plate: "" } })).status,
    ).toBe(400);
    expect(
      provider.mock.calls.filter(([r]) => r.method === "POST"),
    ).toHaveLength(0);
  });
  it("validates changed contracts including serialized JSON before execution", async () => {
    const properties =
      document.paths["/api/flows/test-request/runs"].post.requestBody.content[
        "application/json"
      ].schema.properties.input.properties;
    const original = properties.plate;
    try {
      for (const schema of [
        { type: "string", enum: ["OTHER"] },
        {
          type: "string",
          contentSchema: {
            type: "object",
            required: ["year"],
            properties: { year: { type: "integer" } },
          },
        },
      ]) {
        properties.plate = schema as typeof original;
        provider.mockClear();
        const response = await post(appFor(), {
          ...input(),
          values: { plate: '{"year":"invalid"}' },
        });
        expect(response.status, await response.text()).toBe(400);
        expect(
          provider.mock.calls.filter(([r]) => r.method === "POST"),
        ).toHaveLength(0);
      }
    } finally {
      properties.plate = original;
    }
  });
  it("retains the existing request execution permissions and isolates user histories", async () => {
    expect(
      (await post(appFor(agencyMemberAuthenticator()), input())).status,
    ).toBe(403);
    const original = platformAdministratorAuthenticator();
    const other: Authenticator = {
      async authenticate(request) {
        const actor = await original.authenticate(request);
        return {
          ...actor,
          principal: { ...actor.principal, id: "another-admin" },
        };
      },
    };
    const response = await appFor(other).request(
      "/v1/request-pages/runs?domainId=platform&pageName=generated",
    );
    expect(((await response.json()) as any).data).toEqual([]);
  });
});

it("keeps request results generic across solution installations", async () => {
  const insuranceDocument = JSON.parse(
    JSON.stringify(document).replaceAll("test-request", "sura-autos-provider"),
  );
  const page = generateRequestPage(insuranceDocument, {
    name: "insurance_lookup",
    label: "Lookup",
    operationIds: ["sura-autos-provider"],
  });
  for (const scope of [
    "domain:result_fresh",
    "domain:result_insured",
    "agency:914",
  ]) {
    await env.DB.prepare(
      "INSERT INTO crm_objects(tenant_id,name,label,description,config) VALUES(?,?,?,?,?)",
    )
      .bind(
        scope,
        page.name,
        page.label,
        page.description,
        JSON.stringify(page.config),
      )
      .run();
  }
  const api = createTestApp({
    auth: platformAdministratorAuthenticator(),
    saviaRequestService: {
      fetch: async (request: Request) => {
        if (new URL(request.url).pathname === "/api/openapi.json")
          return Response.json(insuranceDocument);
        if (request.method === "GET")
          return Response.json({ id: "sura-autos-provider", kind: "lookup" });
        return Response.json({
          id: crypto.randomUUID(),
          flowId: "sura-autos-provider",
          mode: "mock",
          status: "success",
          createdAt: new Date().toISOString(),
          versionId: null,
          steps: [],
          result: { response: { placa: "TESTCAR", modelo: 2024 } },
        });
      },
    },
  });
  for (const domainId of ["result_fresh", "result_insured", "tenant:914"]) {
    const response = await post(api, {
      ...input(),
      domainId,
      pageName: page.name,
      actionId: "sura-autos-provider",
    });
    expect(response.status).toBe(200);
    const saved = await response.json<any>();
    expect(saved.result?.type, JSON.stringify(saved)).toBe("request");
    expect(saved.result.data.result.placa).toBe("TESTCAR");
  }
});
