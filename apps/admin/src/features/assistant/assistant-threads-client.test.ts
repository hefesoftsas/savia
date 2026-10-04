import { describe, expect, it } from "vitest";
import { ApiClient } from "@/api/api-client";
import { AssistantThreadsClient } from "./assistant-threads-client";

describe("server conversation history", () => {
  it("reopens messages through a fresh client without browser storage", async () => {
    let saved: any;
    const api = () =>
      new ApiClient({
        baseUrl: "https://savia.test",
        tokenSource: { getAccessToken: async () => "token" },
        fetcher: async (_url, init) => {
          if (init?.method === "PUT") {
            const body = JSON.parse(String(init.body));
            saved = {
              ...body,
              id: "thread",
              revision: 1,
              createdAt: "2026-10-04",
              updatedAt: "2026-10-04",
            };
            return Response.json(saved);
          }
          return Response.json({ threads: saved ? [saved] : [] });
        },
      });
    const first = new AssistantThreadsClient(api());
    await first.save({
      id: "thread",
      title: "Meeting",
      messages: [
        {
          id: "m1",
          role: "user",
          parts: [{ type: "text", text: "What was decided?" }],
        },
      ],
      createdAt: "",
      updatedAt: "",
      revision: 0,
    });
    const second = new AssistantThreadsClient(api());
    expect((await second.list())[0].messages[0].parts[0].text).toBe(
      "What was decided?",
    );
  });
  it("sends the expected revision and exposes conflicts without overwriting", async () => {
    let body: any;
    const client = new AssistantThreadsClient(
      new ApiClient({
        baseUrl: "https://savia.test",
        tokenSource: { getAccessToken: async () => "token" },
        fetcher: async (_url, init) => {
          body = JSON.parse(String(init?.body));
          return Response.json(
            {
              error: { code: "THREAD_CONFLICT", message: "Updated elsewhere" },
            },
            { status: 409 },
          );
        },
      }),
    );
    await expect(
      client.save({
        id: "thread",
        title: "Meeting",
        messages: [],
        createdAt: "",
        updatedAt: "",
        revision: 3,
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(body.expectedRevision).toBe(3);
  });
});
