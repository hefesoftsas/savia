import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { ApiContext } from "../context";
import usage from "./usage";
vi.mock("../services/cost-usage", () => ({
  getFlowCostUsage: vi.fn(async (_env: unknown, org: string) => ({
    organizationId: org,
  })),
}));
function app(role: string, claimOrg = "one", selectedOrg = "one") {
  const app = new Hono<ApiContext>();
  app.use("*", async (c, next) => {
    c.set("saviaBridge", true);
    c.set("organizationId", selectedOrg);
    c.set("jwtPayload", {
      sub: "user",
      organization: { id: claimOrg, role },
    } as never);
    await next();
  });
  app.route("/usage", usage);
  return app;
}
describe("cost quota visibility", () => {
  it("allows selected-tenant managers and denies members and other-tenant admin roles", async () => {
    const allowed = await app("admin").request("http://localhost/usage/limits");
    expect(allowed.status).toBe(200);
    expect(await allowed.json()).toEqual({ organizationId: "one" });
    expect(
      (await app("member").request("http://localhost/usage/limits")).status,
    ).toBe(403);
    expect(
      (await app("admin", "other").request("http://localhost/usage/limits"))
        .status,
    ).toBe(403);
  });
});
