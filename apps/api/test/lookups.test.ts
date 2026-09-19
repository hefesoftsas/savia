import { describe, expect, it, vi } from "vitest";
import { createTestApp } from "./test-app";
import { AuthenticationError, type Authenticator } from "../src/auth/types";
import {
  agencyAdministratorAuthenticator,
  platformAdministratorAuthenticator,
} from "./auth-fixtures";
import type { SaviaRequestService } from "../src/routes/savia-request";

function appFor(auth: Authenticator, service?: SaviaRequestService) {
  return createTestApp({ auth, saviaRequestService: service });
}

describe("DANE city lookups endpoint", () => {
  it("allows authenticated agency administrators to lookup cities", async () => {
    const fetcher = vi.fn(async (request: Request) => {
      expect(request.url).toBe(
        "https://savia-request.internal/api/lookups/dane?city=Medellin",
      );
      return Response.json({
        status: "matched",
        matches: [
          { code: "05001", city: "MEDELLÍN", department: "ANTIOQUIA" },
        ],
        totalMatches: 1,
      });
    });
    const app = appFor(agencyAdministratorAuthenticator(), { fetch: fetcher });
    const response = await app.request("/api/lookups/dane?city=Medellin");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "matched",
      matches: [
        { code: "05001", city: "MEDELLÍN", department: "ANTIOQUIA" },
      ],
      totalMatches: 1,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("validates that the city parameter has at least 2 characters", async () => {
    const fetcher = vi.fn();
    const app = appFor(agencyAdministratorAuthenticator(), { fetch: fetcher });
    const response = await app.request("/api/lookups/dane?city=a");
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Indica una ciudad válida.",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("returns 503 when Savia Request service is unavailable", async () => {
    const app = appFor(agencyAdministratorAuthenticator());
    const response = await app.request("/api/lookups/dane?city=Bogota");
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: { code: "SAVIA_REQUEST_UNAVAILABLE" },
    });
  });

  it("denies unauthenticated requests", async () => {
    const app = appFor({
      authenticate: async () => {
        throw new AuthenticationError(
          "AUTHENTICATION_REQUIRED",
          "Session required",
        );
      },
    });
    const response = await app.request("/api/lookups/dane?city=Bogota");
    expect(response.status).toBe(401);
  });
});
