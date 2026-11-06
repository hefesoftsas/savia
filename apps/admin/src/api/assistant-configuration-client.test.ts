import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "./api-client";
import { AssistantConfigurationClient } from "./assistant-configuration-client";

describe("AssistantConfigurationClient", () => {
  it("sends a replacement key only in the write request and receives redacted state", async () => {
    const fetcher = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
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
            tenants: [],
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
          tenants: [],
        });
      },
    );
    const apiClient = new ApiClient({
      baseUrl: "http://api.savia.test",
      tokenSource: { getAccessToken: async () => "access-token" },
      fetcher,
    });
    const client = new AssistantConfigurationClient(apiClient);

    const saved = await client.saveGlobal({
      apiKey: "not-a-real-browser-input",
      model: "openai/gpt-5",
      allowedModels: ["openai/gpt-5-mini"],
      imageGenerationModel: "provider/image-model",
      speechModel: "provider/speech-model",
    });

    const request = fetcher.mock.calls[0]?.[1] as RequestInit;
    expect(String(request.body)).toContain("not-a-real-browser-input");
    expect(JSON.parse(String(request.body))).toMatchObject({
      allowedModels: ["openai/gpt-5-mini"],
      imageGenerationModel: "provider/image-model",
      speechModel: "provider/speech-model",
    });
    expect(saved.global).toMatchObject({ keyState: "configured" });
    expect(JSON.stringify(saved)).not.toContain("not-a-real-browser-input");
  });

  it("loads the Ask AI model policy", async () => {
    let requestedUrl = "";
    const api = new ApiClient({
      baseUrl: "https://savia.test",
      tokenSource: { getAccessToken: async () => null },
      fetcher: async (input) => {
        requestedUrl = String(input);
        return Response.json({
          defaultModel: "deepseek/deepseek-v4-flash",
          allowedModels: [],
        });
      },
    });

    await expect(
      new AssistantConfigurationClient(api).modelPolicy(),
    ).resolves.toEqual({
      defaultModel: "deepseek/deepseek-v4-flash",
      allowedModels: [],
    });
    expect(new URL(requestedUrl).pathname).toBe("/v1/assistant/model-policy");
  });
});

it("refreshes tenant policy only after the active tenant change commits", async () => {
  let succeed = true;
  const events: string[] = [];
  const listener = (event: Event) => events.push(event.type);
  window.addEventListener("savia:active-tenant-changed", listener);
  const api = new ApiClient({
    baseUrl: "https://savia.test",
    tokenSource: { getAccessToken: async () => null },
    fetcher: async () =>
      succeed
        ? Response.json({ activeTenantId: 101, tenants: [] })
        : Response.json(
            { error: { code: "FORBIDDEN", message: "Forbidden" } },
            { status: 403 },
          ),
  });
  try {
    const client = new AssistantConfigurationClient(api);
    await expect(client.setActiveTenant(101)).resolves.toMatchObject({
      activeTenantId: 101,
    });
    expect(events).toEqual(["savia:active-tenant-changed"]);
    succeed = false;
    await expect(client.setActiveTenant(102)).rejects.toThrow("Forbidden");
    expect(events).toEqual(["savia:active-tenant-changed"]);
  } finally {
    window.removeEventListener("savia:active-tenant-changed", listener);
  }
});

it("loads the catalog with the selected tenant context", async () => {
  let requestedUrl = "";
  const client = new AssistantConfigurationClient(
    new ApiClient({
      baseUrl: "https://savia.test",
      tokenSource: { getAccessToken: async () => null },
      fetcher: async (url) => {
        requestedUrl = String(url);
        return Response.json({ models: [] });
      },
    }),
  );
  await client.models(101);
  expect(new URL(requestedUrl).searchParams.get("tenantId")).toBe("101");
});
