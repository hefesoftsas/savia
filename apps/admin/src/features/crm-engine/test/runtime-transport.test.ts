import { describe, expect, it } from "vitest";
import { crmFetch } from "../api";
import { setCrmRuntime } from "../runtime";

describe("CRM runtime transport", () => {
  it("uses the host transport when Savia mounts the workspace in-process", async () => {
    setCrmRuntime({
      embedded: true,
      transport: async (path) =>
        Response.json(
          { path },
          { status: path === "/api/bootstrap" ? 200 : 404 },
        ),
    });
    const response = await crmFetch("/api/bootstrap");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ path: "/api/bootstrap" });
    setCrmRuntime({ embedded: false });
  });
});
