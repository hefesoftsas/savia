import { describe, it, expect } from "vitest";
import { ApiClient } from "./api-client";
import { PersonalIntegrationsClient } from "./personal-integrations-client";
describe("personal mail transport", () => {
  it("preserves native continuation metadata and escapes cursor query values", async () => {
    let url = "";
    const client = new PersonalIntegrationsClient(
      new ApiClient({
        baseUrl: "https://savia.test",
        tokenSource: { getAccessToken: async () => "token" },
        fetcher: async (input) => {
          url = String(input);
          return Response.json({
            data: [],
            pagination: { nextCursor: "next-page" },
          });
        },
      }),
    );
    expect(
      await client.listMessagePage({
        provider: "outlook",
        cursor: "opaque+/=?",
      }),
    ).toEqual({ messages: [], nextCursor: "next-page" });
    expect(new URL(url).searchParams.get("cursor")).toBe("opaque+/=?");
    expect(new URL(url).searchParams.get("provider")).toBe("outlook");
  });
  it("lists inbox without query and sends a context reference", async () => {
    const calls: { url: string; body: unknown }[] = [];
    const api = new ApiClient({
      baseUrl: "https://savia.test",
      tokenSource: { getAccessToken: async () => "token" },
      fetcher: async (input, init) => {
        calls.push({
          url: String(input),
          body: init?.body ? JSON.parse(String(init.body)) : null,
        });
        return Response.json({
          data:
            init?.method === "POST"
              ? { provider: "gmail", action: "send-email" }
              : [],
        });
      },
    });
    const client = new PersonalIntegrationsClient(api);
    await client.listMessages({ provider: "gmail" });
    expect(calls[0]?.url).toBe(
      "https://savia.test/v1/personal-integrations/messages?provider=gmail",
    );
    await client.listMessages({
      provider: "outlook",
      query: "renewal & review",
    });
    expect(new URL(calls[1]!.url).searchParams.get("query")).toBe(
      "renewal & review",
    );
    const input = {
      provider: "gmail" as const,
      to: ["ana@example.com"],
      subject: "Hi",
      body: "Hello",
      context: [
        {
          apiBasePath: "/v1/studio/1",
          collection: "contacts",
          recordId: "1",
          fields: ["name"],
        },
      ],
    };
    expect(await client.sendMail(input)).toEqual({
      provider: "gmail",
      action: "send-email",
    });
    expect(calls[2]?.body).toEqual(input);
  });
});
