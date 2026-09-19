import {
  beforeAll,
  afterAll,
  afterEach,
  describe,
  it,
  expect,
  vi,
} from "vitest";
import { getPlatformProxy } from "wrangler";
import { readFileSync, readdirSync } from "node:fs";
import app, { createCrmApp } from "../src/index";
import { exampleOpenApi } from "@savia/crm-shared/seed";
let platform: Awaited<ReturnType<typeof getPlatformProxy<any>>>;
const request = (path: string, method = "GET", body?: unknown) =>
  app.request(
    `http://localhost/api${path}`,
    {
      method,
      headers: { "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    platform.env,
  );
async function json(path: string, method = "GET", body?: unknown) {
  const response = await request(path, method, body),
    data: any = await response.json();
  expect(response.status, JSON.stringify(data)).toBeLessThan(300);
  return data;
}
beforeAll(async () => {
  platform = await getPlatformProxy({
    configPath: "wrangler.jsonc",
    persist: false,
  });
  platform.env.INTEGRATION_KEY = "a".repeat(64);
  for (const name of readdirSync("migrations")
    .filter((n) => n.endsWith(".sql"))
    .sort())
    for (const statement of readFileSync(`migrations/${name}`, "utf8")
      .split(/;(?!(?:\s*END\b))/i)
      .filter((s) => s.trim()))
      await platform.env.DB.prepare(statement).run();
  await json("/bootstrap", "POST");
});
afterEach(() => vi.unstubAllGlobals());
afterAll(async () => {
  await platform?.dispose();
});
describe("Operational integrations with isolated D1", () => {
  it("imports a schema with metadata history and runs the local quote exactly once", async () => {
    const item = (
      await json("/integrations", "POST", { document: exampleOpenApi })
    ).data;
    await json(`/integrations/${item.id}/import`, "POST", {
      schema: "Quote",
      name: "integration_quote",
    });
    const versions = (await json("/objects/integration_quote/versions")).data;
    expect(versions).toHaveLength(1);
    await json(`/integrations/${item.id}/connection`, "PUT", { mode: "demo" });
    const payload = {
      operationId: "createQuote",
      body: { name: "Equipo", seats: 2, plan: "Profesional" },
      confirmWrite: true,
      idempotencyKey: "quote-key-001",
    };
    const result = await json(
      `/integrations/${item.id}/execute`,
      "POST",
      payload,
    );
    expect(result.run.status).toBe("succeeded");
    expect(result.data.monthlyTotal).toBe(178000);
    const replay = await json(
      `/integrations/${item.id}/execute`,
      "POST",
      payload,
    );
    expect(replay.replayed).toBe(true);
    expect(replay.data.quoteId).toBe(result.data.quoteId);
    expect(
      (
        await request(`/integrations/${item.id}/execute`, "POST", {
          ...payload,
          body: { ...payload.body, seats: 3 },
        })
      ).status,
    ).toBe(409);
    const history = (await json(`/integrations/${item.id}/runs`)).data;
    expect(history).toHaveLength(1);
    const record = await json(
      `/integrations/${item.id}/runs/${result.run.id}/save`,
      "POST",
      {
        object: "integration_quote",
        mapping: { name: "/project", seats: "/seats", plan: "/plan" },
      },
    );
    expect(record.data.name).toBe("Equipo");
    const savedAgain = await json(
      `/integrations/${item.id}/runs/${result.run.id}/save`,
      "POST",
      {
        object: "integration_quote",
        mapping: { name: "/project", seats: "/seats", plan: "/plan" },
      },
    );
    expect(savedAgain.data.id).toBe(record.data.id);
  });
  it("requires an explicit saved connection and write authorization", async () => {
    const item = (
      await json("/integrations", "POST", { document: exampleOpenApi })
    ).data;
    expect(
      (
        await request(`/integrations/${item.id}/execute`, "POST", {
          operationId: "createQuote",
          body: { name: "A", seats: 1 },
          confirmWrite: true,
        })
      ).status,
    ).toBe(422);
    await json(`/integrations/${item.id}/connection`, "PUT", { mode: "demo" });
    expect(
      (
        await request(`/integrations/${item.id}/execute`, "POST", {
          operationId: "createQuote",
          body: { name: "A", seats: 1 },
        })
      ).status,
    ).toBe(422);
  });
  it("keeps credentials encrypted and out of responses while using safe retries on GET", async () => {
    const operation = {
      operationId: "getClient",
      parameters: [
        { name: "id", in: "path", required: true, schema: { type: "string" } },
        { name: "limit", in: "query", schema: { type: "integer", minimum: 1 } },
      ],
      responses: {
        200: {
          description: "OK",
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["name"],
                properties: {
                  name: { type: "string" },
                  token: { type: "string" },
                },
              },
            },
          },
        },
      },
    };
    const document = {
      openapi: "3.1.0",
      info: { title: "Mock API", version: "1" },
      paths: { "/clients/{id}": { get: operation } },
    };
    const item = (await json("/integrations", "POST", { document })).data,
      token = "confidential-test-token";
    await json(`/integrations/${item.id}/connection`, "PUT", {
      mode: "external",
      baseUrl: "https://api.provider.com/v1",
      authType: "bearer",
      secret: token,
    });
    const stored = await platform.env.DB.prepare(
      "SELECT encrypted_secret FROM crm_integrations WHERE id=?",
    )
      .bind(item.id)
      .first();
    expect(stored.encrypted_secret).not.toContain(token);
    expect(JSON.stringify(await json("/integrations"))).not.toContain(token);
    let calls = 0;
    const mocked = vi.fn(async (input: any, init: any) => {
      const url = new URL(String(input));
      if (url.hostname === "cloudflare-dns.com")
        return Response.json({
          Status: 0,
          Answer: [{ type: 1, data: "1.1.1.1" }],
        });
      calls++;
      expect(url.toString()).toBe(
        "https://api.provider.com/v1/clients/customer-1?limit=3",
      );
      expect(new Headers(init.headers).get("Authorization")).toBe(
        `Bearer ${token}`,
      );
      expect(init.redirect).toBe("error");
      return calls === 1
        ? new Response("busy", { status: 503 })
        : Response.json({ name: "Empresa", token });
    });
    vi.stubGlobal("fetch", mocked);
    const result = await json(`/integrations/${item.id}/execute`, "POST", {
      operationId: "getClient",
      parameters: { "path:id": "customer-1", "query:limit": "3" },
      idempotencyKey: "read-key-001",
    });
    expect(result.run.status).toBe("succeeded");
    expect(result.run.attempts).toBe(2);
    expect(result.data.token).toBe("[redactado]");
    expect(calls).toBe(2);
  });
  it("never automatically retries a write without declared provider idempotency", async () => {
    const item = (
      await json("/integrations", "POST", { document: exampleOpenApi })
    ).data;
    await json(`/integrations/${item.id}/connection`, "PUT", {
      mode: "external",
      baseUrl: "https://api.provider.com",
      authType: "none",
    });
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: any) => {
        if (new URL(String(input)).hostname === "cloudflare-dns.com")
          return Response.json({
            Status: 0,
            Answer: [{ type: 1, data: "1.1.1.1" }],
          });
        calls++;
        return new Response("unavailable", { status: 503 });
      }),
    );
    const result = await json(`/integrations/${item.id}/execute`, "POST", {
      operationId: "createQuote",
      body: { name: "A", seats: 1 },
      confirmWrite: true,
      idempotencyKey: "write-key-001",
    });
    expect(result.run.status).toBe("failed");
    expect(result.run.attempts).toBe(1);
    expect(calls).toBe(1);
  });
});

it("keeps dynamic connection secrets and run responses private between users in one tenant", async () => {
  const owner = createCrmApp("shared", { principalId: "alice" });
  const other = createCrmApp("shared", { principalId: "bob" });
  const created = await owner.request(
    "http://localhost/api/integrations",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ document: exampleOpenApi }),
    },
    platform.env,
  );
  expect(created.status).toBe(201);
  const {
    data: { id },
  } = (await created.json()) as { data: { id: string } };
  const list = await other.request(
    "http://localhost/api/integrations",
    {},
    platform.env,
  );
  expect(await list.json()).toEqual({ data: [] });
  for (const [suffix, method, body] of [
    ["/runs", "GET", undefined],
    ["/connection", "PUT", { mode: "demo" }],
    ["/execute", "POST", { operationId: "quote", confirmWrite: true }],
    [
      "/runs/unknown/save",
      "POST",
      { object: "clientes", mapping: { name: "/name" } },
    ],
  ] as const) {
    const response = await other.request(
      `http://localhost/api/integrations/${id}${suffix}`,
      {
        method,
        headers: { "Content-Type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}),
      },
      platform.env,
    );
    expect(response.status).toBe(404);
  }
});

it("uses the injected transport for OpenAPI DNS validation, import and execution", async () => {
  const calls: string[] = [];
  const integrationFetch: typeof fetch = async (input) => {
    const url = new URL(String(input));
    calls.push(url.toString());
    if (url.hostname === "cloudflare-dns.com")
      return Response.json({
        Status: 0,
        Answer: [{ type: 1, data: "1.1.1.1" }],
      });
    if (url.pathname === "/contract.json") return Response.json(exampleOpenApi);
    return Response.json({ quoteId: "native-transport", monthlyTotal: 100 });
  };
  const isolated = createCrmApp("native-transport", {
    principalId: "native-owner",
    integrationFetch,
  });
  const send = async (path: string, method: string, body: unknown) => {
    const response = await isolated.request(
      `http://localhost/api${path}`,
      {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      platform.env,
    );
    const value: any = await response.json();
    expect(response.status, JSON.stringify(value)).toBeLessThan(300);
    return value;
  };
  const item = (
    await send("/integrations", "POST", {
      url: "https://api.provider.com/contract.json",
    })
  ).data;
  await send(`/integrations/${item.id}/connection`, "PUT", {
    mode: "external",
    baseUrl: "https://api.provider.com",
    authType: "none",
  });
  const result = await send(`/integrations/${item.id}/execute`, "POST", {
    operationId: "createQuote",
    body: { name: "Native", seats: 1 },
    confirmWrite: true,
    idempotencyKey: "native-transport-1",
  });
  expect(result.run.status).toBe("succeeded");
  expect(
    calls.filter((url) => url.includes("cloudflare-dns.com")),
  ).toHaveLength(4);
  expect(calls.some((url) => url.endsWith("/contract.json"))).toBe(true);
  expect(calls.some((url) => url.endsWith("/quotes"))).toBe(true);
});
