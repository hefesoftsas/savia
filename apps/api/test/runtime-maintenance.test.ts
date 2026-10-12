import { describe, expect, it } from "vitest";
import runtime, { type RuntimeEnvironment } from "../src/runtime";

describe("persistence maintenance", () => {
  const environment = { SAVIA_MAINTENANCE: "true" } as RuntimeEnvironment;
  it.each(["GET", "POST", "PUT", "DELETE"])(
    "blocks %s before accessing persistence",
    async (method) => {
      const response = await runtime.fetch(
        new Request("https://savia.test/v1/collections", { method }),
        environment,
      );
      expect(response.status).toBe(503);
      expect(response.headers.get("retry-after")).toBe("60");
      expect(
        ((await response.json()) as { error: { code: string } }).error.code,
      ).toBe("MAINTENANCE");
    },
  );
  it("keeps the maintenance health endpoint available", async () => {
    expect(
      await (
        await runtime.fetch(
          new Request("https://savia.test/health"),
          environment,
        )
      ).json(),
    ).toEqual({ status: "maintenance" });
  });
  it("pauses scheduled persistence writers before touching bindings", async () => {
    await expect(
      runtime.scheduled({} as ScheduledController, environment),
    ).resolves.toBeUndefined();
  });
});
