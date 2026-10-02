import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "@/api/api-client";
import { CompanionRecordingsClient } from "./client";
it("fetches private audio with the Savia token and explicit processing consent", async () => {
  const requests: Request[] = [];
  const api = new ApiClient({
    baseUrl: "https://api.savia.test",
    tokenSource: { getAccessToken: async () => "token" },
    fetcher: async (url, init) => {
      const r = new Request(url, init);
      requests.push(r);
      return r.method === "GET"
        ? new Response("ogg", { headers: { "content-type": "audio/ogg" } })
        : Response.json({});
    },
  });
  const client = new CompanionRecordingsClient(api);
  expect((await client.audio("sample")).type).toBe("audio/ogg");
  await client.generate("sample");
  expect(requests[0].headers.get("authorization")).toBe("Bearer token");
  expect(await requests[1].json()).toEqual({ consent: true });
  expect(requests[1].url).toBe(
    "https://api.savia.test/v1/companion/recordings/sample/notes",
  );
});
it("does not automatically retry billable processing", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(
      Response.json(
        { error: { code: "UPSTREAM_TIMEOUT", message: "Unknown outcome" } },
        { status: 504 },
      ),
    );
  const client = new CompanionRecordingsClient(
    new ApiClient({
      baseUrl: "https://api.savia.test",
      tokenSource: { getAccessToken: async () => "token" },
      fetcher,
    }),
  );
  await expect(client.generate("id")).rejects.toThrow("Unknown outcome");
  expect(fetcher).toHaveBeenCalledTimes(1);
});
