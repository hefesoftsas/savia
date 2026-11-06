import { describe, expect, it } from "vitest";
import { studioFetch } from "../api";
import { setStudioRuntime } from "../runtime";

describe("CRM runtime transport", () => {
  it("uses the host transport when Savia mounts the workspace in-process", async () => {
    setStudioRuntime({
      embedded: true,
      transport: async (path) =>
        Response.json(
          { path },
          { status: path === "/api/bootstrap" ? 200 : 404 },
        ),
    });
    const response = await studioFetch("/api/bootstrap");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ path: "/api/bootstrap" });
    setStudioRuntime({ embedded: false });
  });
});
