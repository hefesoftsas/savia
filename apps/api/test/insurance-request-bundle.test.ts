import { describe, expect, it, vi } from "vitest";
import { runtimeReleaseCatalog } from "@savia/release-catalog/runtime";

describe("quote solution request bundle", () => {
  it("ensures the private bundle before installing the quote wizard", async () => {
    const fetch = vi.fn(async (request: Request) => {
      expect(request.url).toBe(
        "https://savia-request.internal/api/bundles/insurance-auto-light/ensure",
      );
      expect(request.method).toBe("POST");
      expect(request.headers.get("content-type")).toBe("application/json");
      expect(await request.json()).toEqual({});
      return Response.json({ id: "insurance-auto-light", version: "1.0.0" });
    });
    const beforeInstall = runtimeReleaseCatalog.beforeSolutionInstall({
      fetch,
    });

    await beforeInstall({ id: "savia.insurance-quoter" } as never);
    await beforeInstall({ id: "another.solution" } as never);

    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
