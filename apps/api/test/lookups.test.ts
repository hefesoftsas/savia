import { beforeAll, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { createTestApp } from "./test-app";
import { AuthenticationError, type Authenticator } from "../src/auth/types";
import {
  agencyAdministratorAuthenticator,
  platformAdministratorAuthenticator,
} from "./auth-fixtures";
import type { SaviaRequestService } from "../src/routes/savia-request";

const migrations = Object.entries(
  import.meta.glob<string>("../../../packages/db/migrations/*.sql", {
    eager: true,
    import: "default",
    query: "?raw",
  }),
).sort(([a], [b]) => a.localeCompare(b));

beforeAll(async () => {
  for (const [, sql] of migrations)
    for (const statement of sql.split("--> statement-breakpoint")) {
      const normalized = statement
        .replace(/^--.*$/gm, "")
        .replace(/\s+/g, " ")
        .trim();
      if (normalized) await env.DB.exec(normalized);
    }
});

function appFor(auth: Authenticator, service?: SaviaRequestService) {
  return createTestApp({ auth, saviaRequestService: service });
}

describe("DANE city lookups endpoint", () => {
  it("serves DANE lookups through the selected data domain", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({
        status: "matched",
        matches: [{ code: "11001", city: "BOGOTÁ", department: "BOGOTÁ D.C." }],
      }),
    );
    const app = createTestApp({
      auth: platformAdministratorAuthenticator(),
      documents: env.DOCUMENTS,
      saviaRequestService: { fetch: fetcher },
    });

    const response = await app.request(
      "/v1/data-domains/platform/api/lookups/dane?city=Bo",
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      matches: [{ code: "11001" }],
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("allows authenticated agency administrators to lookup cities", async () => {
    const fetcher = vi.fn(async (request: Request) => {
      expect(request.url).toBe(
        "https://savia-request.internal/api/lookups/dane?city=Medellin",
      );
      return Response.json({
        status: "matched",
        matches: [{ code: "05001", city: "MEDELLÍN", department: "ANTIOQUIA" }],
        totalMatches: 1,
      });
    });
    const app = appFor(agencyAdministratorAuthenticator(), { fetch: fetcher });
    const response = await app.request("/api/lookups/dane?city=Medellin");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "matched",
      matches: [{ code: "05001", city: "MEDELLÍN", department: "ANTIOQUIA" }],
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
