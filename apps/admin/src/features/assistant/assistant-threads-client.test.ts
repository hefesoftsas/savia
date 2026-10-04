import { describe, expect, it } from "vitest";
import { ApiClient } from "@/api/api-client";
import {
  AssistantThreadsClient,
  type SyncedThread,
} from "./assistant-threads-client";

describe("server conversation history", () => {
  it("reopens messages through a fresh client without browser storage", async () => {
    let saved: any;
    const api = () =>
      new ApiClient({
        baseUrl: "https://savia.test",
        tokenSource: { getAccessToken: async () => "token" },
        fetcher: async (_url, init) => {
          const url = new URL(String(_url));
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
          if (url.pathname === "/api/assistant/threads") {
            const { messages, ...summary } = saved ?? {};
            return Response.json({
              threads: saved
                ? [
                    {
                      ...summary,
                      messageCount: messages.length,
                      preview: "What was decided?",
                    },
                  ]
                : [],
            });
          }
          return Response.json(saved);
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
    const summaries = await second.list();
    expect(summaries[0]).toMatchObject({
      id: "thread",
      messageCount: 1,
      preview: "What was decided?",
    });
    expect(summaries[0]).not.toHaveProperty("messages");
    expect((await second.get("thread")).messages[0].parts[0].text).toBe(
      "What was decided?",
    );
  });
  it("does not send the server-owned tenant id when saving a loaded thread", async () => {
    let body: Record<string, unknown> | undefined;
    const client = new AssistantThreadsClient(
      new ApiClient({
        baseUrl: "https://savia.test",
        tokenSource: { getAccessToken: async () => "token" },
        fetcher: async (_url, init) => {
          body = JSON.parse(String(init?.body));
          return Response.json({});
        },
      }),
    );
    const thread = {
      id: "thread",
      title: "Meeting",
      messages: [],
      createdAt: "",
      updatedAt: "",
      revision: 2,
      context: {
        kind: "recording",
        id: "recording-1",
        title: "Planning",
        tenantId: 101,
      },
    } as SyncedThread;
    await client.save(thread);
    expect(body?.context).toEqual({
      kind: "recording",
      id: "recording-1",
      title: "Planning",
    });
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
