import { describe, expect, it, vi } from "vitest";
import { createTestApp } from "./test-app";
import {
  agencyAdministratorAuthenticator,
  agencyMemberAuthenticator,
  platformAdministratorAuthenticator,
} from "./auth-fixtures";
import type { SaviaRequestService } from "../src/routes/savia-request";

function appFor(
  auth: Parameters<typeof createTestApp>[0]["auth"],
  service?: SaviaRequestService,
) {
  return createTestApp({ auth, saviaRequestService: service });
}

describe("Savia request tenant scope", () => {
  it("lets a tenant admin read its own scope and forwards the tenant header", async () => {
    const fetcher = vi.fn(async (request: Request) => {
      expect(request.headers.get("x-savia-tenant")).toBe("agency:101");
      expect(request.headers.get("x-savia-actor")).toBe(
        "test-agency-administrator",
      );
      expect(request.url).toBe(
        "https://savia-request.internal/api/flows?tenant=agency%3A101",
      );
      return Response.json([]);
    });
    const response = await appFor(agencyAdministratorAuthenticator(), {
      fetch: fetcher,
    }).request("/v1/savia-request/api/flows?tenant=agency%3A101");
    expect(response.status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("denies cross-tenant access and keeps the legacy platform boundary", async () => {
    const fetcher = vi.fn(() => Response.json([]));
    const app = appFor(agencyAdministratorAuthenticator(), { fetch: fetcher });
    expect(
      (await app.request("/v1/savia-request/api/flows?tenant=agency%3A999"))
        .status,
    ).toBe(403);
    expect((await app.request("/v1/savia-request/api/flows")).status).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("allows members to execute runs but restricts editor mutations to admins", async () => {
    const fetcher = vi.fn(() => Response.json({ ok: true }));
    const memberApp = appFor(agencyMemberAuthenticator(), { fetch: fetcher });
    expect(
      (
        await memberApp.request(
          "/v1/savia-request/api/flows/demo/runs?tenant=agency%3A101",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ mode: "mock", input: {} }),
          },
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await memberApp.request(
          "/v1/savia-request/api/flows/demo/variables?tenant=agency%3A101",
          {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify([]),
          },
        )
      ).status,
    ).toBe(403);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("lets platform admins operate in any tenant scope", async () => {
    const fetcher = vi.fn(async (request: Request) => {
      expect(request.headers.get("x-savia-tenant")).toBe("agency:999");
      return Response.json({ ok: true });
    });
    const response = await appFor(platformAdministratorAuthenticator(), {
      fetch: fetcher,
    }).request(
      "/v1/savia-request/api/flows/demo/variables?tenant=agency%3A999",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify([]),
      },
    );
    expect(response.status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid tenant ids", async () => {
    const fetcher = vi.fn(() => Response.json([]));
    const response = await appFor(platformAdministratorAuthenticator(), {
      fetch: fetcher,
    }).request("/v1/savia-request/api/flows?tenant=agency%2F..%2Fx");
    expect(response.status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
