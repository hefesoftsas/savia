import { env } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";
import { createTestApp } from "./test-app";
import { AuthenticationError, type Authenticator } from "../src/auth/types";
import {
  agencyAdministratorAuthenticator,
  agencyMemberAuthenticator,
  platformAdministratorAuthenticator,
} from "./auth-fixtures";
import type { SaviaRequestService } from "../src/routes/savia-request";

function appFor(auth: Authenticator, service?: SaviaRequestService) {
  return createTestApp({ auth, saviaRequestService: service });
}
const routes = [
  ["GET", "/api/flows/test/versions/version-id"],
  ["GET", "/api/flows/test/runs/run-id"],
  ["GET", "/api/flows"],
  ["GET", "/api/flows/test"],
  ["PUT", "/api/flows/test"],
  ["DELETE", "/api/flows/test"],
  ["POST", "/api/flows/test/duplicate"],
  ["PUT", "/api/flows/test/variables"],
  ["POST", "/api/flows/test/variables/reveal"],
  ["POST", "/api/flows/test/publish"],
  ["GET", "/api/flows/test/runs"],
  ["POST", "/api/flows/test/runs"],
  ["POST", "/v1/flows/test/runs"],
  ["GET", "/api/openapi.json"],
  ["GET", "/api/folders"],
  ["POST", "/api/folders"],
  ["DELETE", "/api/folders"],
];

describe("Savia request access boundary", () => {
  for (const [label, auth, status] of [
    [
      "anonymous",
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
    ["agency member", agencyMemberAuthenticator(), 403],
    ["agency administrator", agencyAdministratorAuthenticator(), 403],
  ] as const) {
    it(`denies every editor and Scalar operation to ${label}`, async () => {
      const fetcher = vi.fn(() => Response.json({ ok: true }));
      const app = appFor(auth, { fetch: fetcher });
      for (const [method, path] of routes) {
        const response = await app.request("/v1/savia-request" + path, {
          method,
          headers: { "content-type": "application/json" },
          body: method === "GET" ? undefined : "{}",
        });
        expect(response.status, path).toBe(status);
      }
      expect(fetcher).not.toHaveBeenCalled();
    });
  }
  it("preserves the MVP payload and strips Savia credentials at the private binding", async () => {
    const fetcher = vi.fn(async (request: Request) => {
      expect(request.url).toBe(
        "https://savia-request.internal/api/flows/test/runs",
      );
      expect([...request.headers.keys()]).toEqual(["content-type"]);
      expect(await request.json()).toEqual({
        mode: "mock",
        input: { plate: "TESTCAR" },
      });
      return Response.json({
        id: "run-1",
        steps: [{ responseJson: { result: true } }],
      });
    });
    const response = await appFor(platformAdministratorAuthenticator(), {
      fetch: fetcher,
    }).request("/v1/savia-request/api/flows/test/runs", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer test",
        cookie: "session=test",
      },
      body: JSON.stringify({ mode: "mock", input: { plate: "TESTCAR" } }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      id: "run-1",
      steps: [{ responseJson: { result: true } }],
    });
  });
  it("preserves duplicate-folder conflicts and their message", async () => {
    const app = appFor(platformAdministratorAuthenticator(), {
      fetch: () =>
        Response.json({ error: "Ya existe una carpeta." }, { status: 409 }),
    });
    const response = await app.request("/v1/savia-request/api/folders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"path":"Test"}',
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { message: "Ya existe una carpeta." },
    });
  });
  it("fails closed without a binding and rejects form submissions", async () => {
    expect(
      (
        await appFor(platformAdministratorAuthenticator()).request(
          "/v1/savia-request/api/flows",
        )
      ).status,
    ).toBe(503);
    const fetcher = vi.fn(() => Response.json({}));
    const app = appFor(platformAdministratorAuthenticator(), {
      fetch: fetcher,
    });
    expect(
      (
        await app.request("/v1/savia-request/api/flows/test/runs", {
          method: "POST",
          body: "mode=live",
        })
      ).status,
    ).toBe(415);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
