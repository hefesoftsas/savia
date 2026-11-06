import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createTestApp } from "./test-app";
import { AuthenticationError, type Authenticator } from "../src/auth/types";
import {
  platformAdministratorAuthenticator,
  agencyAdministratorAuthenticator,
} from "./auth-fixtures";
import { requestResultSchema } from "../src/request-results/contracts";
import type { SaviaRequestService } from "../src/routes/savia-request";
const flow = "inventory-stock",
  runId = "f7a692c5-edba-4ec0-8130-a181f96f2b0e";
const saved = {
  id: runId,
  flowId: flow,
  versionId: null,
  mode: "mock",
  status: "success",
  createdAt: "2026-09-06T12:00:00Z",
  steps: [],
  result: { premiumTotal: "100", quoteNumber: "Q1", currency: "COP" },
};
function app(auth: Authenticator, service?: SaviaRequestService) {
  return createTestApp({ auth, saviaRequestService: service });
}
const path = "/v1/request-results/flows/" + flow + "/runs";
describe("generic result API", () => {
  it("wraps authorization and authentication failures without calling the worker", async () => {
    const fetcher = vi.fn();
    for (const [auth, status] of [
      [agencyAdministratorAuthenticator(), 403],
      [
        {
          authenticate: async () => {
            throw new AuthenticationError(
              "AUTHENTICATION_REQUIRED",
              "Session required",
            );
          },
        },
        401,
      ],
    ] as const) {
      const response = await app(auth, { fetch: fetcher }).request(
        path + "/" + runId,
      );
      expect(response.status).toBe(status);
      expect(requestResultSchema.safeParse(await response.json()).success).toBe(
        true,
      );
    }
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("executes exactly once with the unchanged input and no Savia tokens", async () => {
    const requests: Request[] = [];
    const service = {
      fetch: async (request: Request) => {
        requests.push(request);
        return Response.json(
          request.method === "POST" ? saved : { id: flow, kind: "quote" },
        );
      },
    };
    const response = await app(
      platformAdministratorAuthenticator(),
      service,
    ).request(path, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer private",
        cookie: "private",
      },
      body: JSON.stringify({ mode: "mock", input: { plate: "TESTCAR" } }),
    });
    expect(response.status).toBe(200);
    expect(requestResultSchema.safeParse(await response.json()).success).toBe(
      true,
    );
    expect(requests.map((r) => r.method)).toEqual(["GET", "POST"]);
    expect(await requests[1].json()).toEqual({
      mode: "mock",
      input: { plate: "TESTCAR" },
    });
    expect(requests[1].headers.has("authorization")).toBe(false);
    expect(requests[1].headers.has("cookie")).toBe(false);
  });
  it("reads historical results without executing and documents the contract", async () => {
    const fetcher = vi.fn(async (request: Request) => {
      expect(request.method).toBe("GET");
      return Response.json({ run: saved, flow: { id: flow } });
    });
    const api = app(platformAdministratorAuthenticator(), { fetch: fetcher });
    const response = await api.request(path + "/" + runId);
    expect(response.status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const doc = await (await api.request("/openapi.json")).json<any>();
    expect(doc.paths["/v1/request-results/flows/{flowId}/runs"]).toBeDefined();
    expect(doc.components.schemas.RequestResult).toBeDefined();
  });
  it("keeps validation and service failures in the same envelope", async () => {
    const response = await app(platformAdministratorAuthenticator()).request(
      path,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      },
    );
    expect(response.status).toBe(400);
    expect(requestResultSchema.safeParse(await response.json()).success).toBe(
      true,
    );
    const unavailable = await app(platformAdministratorAuthenticator()).request(
      path + "/" + runId,
    );
    expect(unavailable.status).toBe(503);
    expect(
      requestResultSchema.safeParse(await unavailable.json()).success,
    ).toBe(true);
  });
});

beforeAll(async () => {
  const migrations = Object.entries(
    import.meta.glob<string>("../../../packages/db/migrations/*.sql", {
      eager: true,
      import: "default",
      query: "?raw",
    }),
  )
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, sql]) => sql);
  for (const sql of migrations)
    for (const statement of sql
      .split("--> statement-breakpoint")
      .map((value) =>
        value
          .replace(/^--.*$/gm, "")
          .replace(/\s+/g, " ")
          .trim(),
      )
      .filter(Boolean))
      await env.DB.exec(statement);
});

it("returns the same generic envelope for stored and newly executed flows", async () => {
  const id = "sbs-producto-9";
  const fetcher = vi.fn(async (request: Request) =>
    Response.json(
      request.method === "POST"
        ? { ...saved, flowId: id }
        : new URL(request.url).pathname.endsWith("/flows/" + id)
          ? { id }
          : { flow: { id }, run: { ...saved, flowId: id } },
    ),
  );
  const api = createTestApp({
    auth: platformAdministratorAuthenticator(),
    saviaRequestService: { fetch: fetcher },
  });
  const url = "/v1/request-results/flows/" + id + "/runs/" + runId;
  const fresh = await api.request(url);
  expect((await fresh.json<any>()).type).toBe("request");
  const executed = await api.request(
    "/v1/request-results/flows/" + id + "/runs",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "mock", input: {} }),
    },
  );
  const result = await executed.json<any>();
  expect(result.type).toBe("request");
  expect(result.data.result.premiumTotal).toBe("100");
});
