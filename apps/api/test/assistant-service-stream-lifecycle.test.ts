import { describe, expect, it, vi } from "vitest";

const { streamText } = vi.hoisted(() => ({ streamText: vi.fn() }));

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    convertToModelMessages: vi.fn(async () => []),
    streamText,
  };
});

import { SaviaAssistantService } from "../src/assistant/service";

describe("SaviaAssistantService stream lifecycle", () => {
  it("finishes the reply when MCP cleanup has not resolved", async () => {
    const close = vi.fn(() => new Promise<void>(() => undefined));
    streamText.mockImplementation(({ onEnd }) => ({
      toUIMessageStreamResponse: () =>
        new Response(
          new ReadableStream({
            async start(controller) {
              controller.enqueue(
                new TextEncoder().encode('data: {"type":"finish"}\n\n'),
              );
              await onEnd();
              controller.close();
            },
          }),
          { headers: { "content-type": "text/event-stream" } },
        ),
    }));
    const service = new SaviaAssistantService(
      {
        database: {} as D1Database,
        mcpUrl: "http://mcp:8789/mcp",
        mcpSharedSecret: "internal-secret",
        openRouterApiKey: "server-only-key",
      },
      {
        mcpClientFactory: async () => ({
          callTool: async () => ({ content: [] }),
          close,
          tools: async () => ({}),
        }),
      },
    );

    const response = await service.chat({
      principalId: "test-platform-admin",
      authorization: "Bearer current-user-token",
      messages: [
        {
          id: "message-1",
          role: "user",
          parts: [{ type: "text", text: "Hello" }],
        },
      ],
    });

    const body = await Promise.race([
      response.text(),
      new Promise<string>((resolve) => {
        setTimeout(() => resolve("timed out"), 50);
      }),
    ]);

    expect(body).toBe('data: {"type":"finish"}\n\n');
    expect(close).toHaveBeenCalledOnce();
  });

  it("requires a structured visualization after an explicit chart request", async () => {
    streamText.mockImplementation(() => ({
      toUIMessageStreamResponse: () => new Response(null),
    }));
    const service = new SaviaAssistantService(
      {
        database: {} as D1Database,
        mcpUrl: "http://mcp:8789/mcp",
        mcpSharedSecret: "internal-secret",
        openRouterApiKey: "server-only-key",
      },
      {
        mcpClientFactory: async () => ({
          callTool: async () => ({ content: [] }),
          close: async () => undefined,
          tools: async () => ({}),
        }),
      },
    );

    await service.chat({
      principalId: "test-platform-admin",
      authorization: "Bearer current-user-token",
      messages: [
        {
          id: "message-1",
          role: "user",
          parts: [{ type: "text", text: "Haz una gráfica de clientes" }],
        },
      ],
    });

    const options = streamText.mock.calls.at(-1)?.[0] as {
      prepareStep?: (input: { stepNumber: number }) => unknown;
      toolChoice?: unknown;
    };
    expect(options.toolChoice).toBe("required");
    expect(options.prepareStep?.({ stepNumber: 2 })).toMatchObject({
      toolChoice: {
        type: "tool",
        toolName: "savia_present_visualization",
      },
    });
  });
});
