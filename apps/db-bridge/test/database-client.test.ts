import { expect, it } from "vitest";
import { createDatabaseBridgeClient } from "../../api/src/studio/database-bridge";
it("does not retry uncertain writes", async () => {
  let calls = 0;
  const client = createDatabaseBridgeClient({
    baseUrl: "http://bridge",
    secret: "secret",
    fetcher: async () => {
      calls++;
      throw new Error("lost response");
    },
  });
  await expect(client.mutate({} as any)).rejects.toMatchObject({
    outcome: "unknown",
  });
  expect(calls).toBe(1);
});
it("preserves safe upstream conflicts", async () => {
  const client = createDatabaseBridgeClient({
    baseUrl: "http://bridge",
    secret: "secret",
    fetcher: async () =>
      Response.json(
        { code: "DATABASE_CONFLICT", error: "Conflict" },
        { status: 409 },
      ),
  });
  await expect(client.mutate({} as any)).rejects.toMatchObject({
    status: 409,
    code: "DATABASE_CONFLICT",
  });
});

it("tells the caller to refresh after upstream uncertain writes", async () => {
  const client = createDatabaseBridgeClient({
    baseUrl: "http://bridge",
    secret: "secret",
    fetcher: async () =>
      Response.json(
        { code: "DATABASE_TIMEOUT", outcome: "unknown" },
        { status: 504 },
      ),
  });
  await expect(client.mutate({} as any)).rejects.toMatchObject({
    outcome: "unknown",
    message: expect.stringContaining("Refresh before repeating"),
  });
});
