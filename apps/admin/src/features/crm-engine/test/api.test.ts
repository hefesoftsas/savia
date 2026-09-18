import { afterEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "../api";
import { setCrmRuntime } from "../runtime";

afterEach(() => setCrmRuntime({ embedded: false }));

describe("apiFetch", () => {
  it("accepts a successful empty response", async () => {
    const transport = vi.fn(async () => new Response(null, { status: 204 }));
    setCrmRuntime({ embedded: true, transport });

    await expect(apiFetch("/api/extensions/test")).resolves.toBeUndefined();
    expect(transport).toHaveBeenCalledWith(
      "/api/extensions/test",
      expect.any(Object),
    );
  });
});

it.each([
  new Response("Forbidden", { status: 403 }),
  new Response(null, { status: 401 }),
])("preserves authorization status for non-JSON failures", async (response) => {
  setCrmRuntime({ embedded: true, transport: async () => response });
  await expect(apiFetch("/api/records/private")).rejects.toMatchObject({
    status: response.status,
  });
});
