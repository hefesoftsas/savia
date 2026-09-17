import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "./api-client";
import { AssistantConfigurationClient } from "./assistant-configuration-client";

describe("AssistantConfigurationClient", () => {
  it("sends a replacement key only in the write request and receives redacted state", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/v1/assistant/configuration/global")) {
        return Response.json({
          global: {
            scope: "global",
            keyState: "configured",
            model: "openai/gpt-5",
            updatedAt: "2026-09-03T12:00:00.000Z",
            updatedBy: "admin-1",
          },
          agencies: [],
        });
      }
      return Response.json({
        global: {
          scope: "global",
          keyState: "configured",
          model: "openai/gpt-5",
          updatedAt: "2026-09-03T12:00:00.000Z",
          updatedBy: "admin-1",
        },
        agencies: [],
      });
    });
    const apiClient = new ApiClient({
      baseUrl: "http://api.savia.test",
      tokenSource: { getAccessToken: async () => "access-token" },
      fetcher,
    });
    const client = new AssistantConfigurationClient(apiClient);

    const saved = await client.saveGlobal({
      apiKey: "not-a-real-browser-input",
      model: "openai/gpt-5",
    });

    const request = fetcher.mock.calls[0]?.[1] as RequestInit;
    expect(String(request.body)).toContain("not-a-real-browser-input");
    expect(saved.global).toMatchObject({ keyState: "configured" });
    expect(JSON.stringify(saved)).not.toContain("not-a-real-browser-input");
  });
});
