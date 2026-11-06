import { describe, expect, it, vi } from "vitest";
import { createStudioApp } from "../src/index";

const env = { DB: {} as D1Database } as never;

describe("workspace DANE lookup", () => {
  it.each(["domain:platform", "agency:101"])(
    "forwards a %s lookup to Savia Request",
    async (tenant) => {
      const fetch = vi.fn(async (request: Request) => {
        expect(request.url).toBe(
          "https://savia-request.internal/api/lookups/dane?city=Bo",
        );
        return Response.json({
          status: "matched",
          matches: [
            { code: "11001", city: "BOGOTÁ", department: "BOGOTÁ D.C." },
          ],
        });
      });
      const app = createStudioApp(tenant, {
        saviaRequestService: { fetch },
      });

      const response = await app.request(
        "https://crm.internal/api/lookups/dane?city=Bo",
        {},
        env,
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        matches: [{ code: "11001" }],
      });
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  it("rejects an invalid city before calling the service", async () => {
    const fetch = vi.fn();
    const app = createStudioApp("domain:platform", {
      saviaRequestService: { fetch },
    });

    const response = await app.request(
      "https://crm.internal/api/lookups/dane?city=B",
      {},
      env,
    );

    expect(response.status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reports an unavailable Savia Request binding", async () => {
    const response = await createStudioApp("domain:platform").request(
      "https://crm.internal/api/lookups/dane?city=Bo",
      {},
      env,
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: { code: "SAVIA_REQUEST_UNAVAILABLE" },
    });
  });
});
