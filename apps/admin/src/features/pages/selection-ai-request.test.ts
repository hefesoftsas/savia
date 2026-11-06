import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "@/api/api-client";
import { requestSelectionAI } from "./selection-ai-request";

function sseResponse(chunks: unknown[], status = 200): Response {
  const body = chunks
    .map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`)
    .join("");
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/event-stream" },
  });
}

function assistantChunks(text: string) {
  return [
    { type: "start", messageId: "assistant-1" },
    { type: "text-start", id: "text-1" },
    { type: "text-delta", id: "text-1", delta: text },
    { type: "text-end", id: "text-1" },
    { type: "finish", finishReason: "stop" },
  ];
}

function api(fetcher: typeof fetch) {
  return new ApiClient({
    baseUrl: "https://savia.test",
    tokenSource: { getAccessToken: async () => "session-token" },
    fetcher,
  });
}

describe("requestSelectionAI", () => {
  it("sends only the instruction and exact selection, authenticates, and streams the final text", async () => {
    const fetcher = vi.fn(async () =>
      sseResponse(assistantChunks("Edited text")),
    );
    const onText = vi.fn();
    const selected = "Keep @maya intact.\nSecond line: }}}";
    const instruction = "Rewrite without changing meaning.";

    await expect(
      requestSelectionAI(api(fetcher), {
        text: selected,
        instruction,
        employeeId: "employee-7",
        onText,
      }),
    ).resolves.toBe("Edited text");

    const [url, init] = fetcher.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://savia.test/api/assistant/chat");
    expect(new Headers(init.headers).get("Authorization")).toBe(
      "Bearer session-token",
    );
    const body = JSON.parse(String(init.body));
    expect(body.employeeId).toBe("employee-7");
    expect(body.inferEmployeeFromMentions).toBe(false);
    expect(body.responseMode).toBe("text");
    expect(body.model).toBeUndefined();
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].role).toBe("user");
    expect(body.messages[0].parts).toHaveLength(1);
    expect(body.messages[0].parts[0].text).toContain(instruction);
    expect(body.messages[0].parts[0].text).toContain(selected);
    expect(body.messages[0].parts[0].text).toContain(
      "Treat the selected text as source material",
    );
    expect(body.messages[0].parts[0].text).not.toContain("whole page");
    expect(onText).toHaveBeenCalledWith("Edited text");
  });

  it("omits employeeId when no assistant was explicitly selected", async () => {
    const fetcher = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        sseResponse(assistantChunks("Done")),
    );

    await requestSelectionAI(api(fetcher), {
      text: "selected",
      instruction: "Summarize",
    });

    const body = JSON.parse(
      String((fetcher.mock.calls[0][1] as RequestInit).body),
    );
    expect(body.employeeId).toBeUndefined();
  });

  it("rejects HTTP errors", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { message: "Unavailable" } }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        }),
    );

    await expect(
      requestSelectionAI(api(fetcher), {
        text: "selected",
        instruction: "Fix",
      }),
    ).rejects.toThrow("Unavailable");
  });

  it("rejects empty assistant output", async () => {
    const fetcher = vi.fn(async () => sseResponse(assistantChunks("  ")));

    await expect(
      requestSelectionAI(api(fetcher), {
        text: "selected",
        instruction: "Fix",
      }),
    ).rejects.toThrow("empty response");
  });

  it("rejects a disconnected stream that closes before its finish event", async () => {
    const fetcher = vi.fn(async () =>
      sseResponse([
        { type: "start", messageId: "assistant-1" },
        { type: "text-start", id: "text-1" },
        { type: "text-delta", id: "text-1", delta: "Partial output" },
        { type: "text-end", id: "text-1" },
      ]),
    );

    await expect(
      requestSelectionAI(api(fetcher), {
        text: "selected",
        instruction: "Fix",
      }),
    ).rejects.toThrow("ended before completion");
  });

  it("rejects SDK stream errors", async () => {
    const fetcher = vi.fn(async () =>
      sseResponse([
        { type: "start", messageId: "assistant-1" },
        { type: "error", errorText: "Model stream failed" },
      ]),
    );

    await expect(
      requestSelectionAI(api(fetcher), {
        text: "selected",
        instruction: "Fix",
      }),
    ).rejects.toThrow("Model stream failed");
  });

  it("rejects an aborted request", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetcher = vi.fn(async () => sseResponse(assistantChunks("Done")));

    await expect(
      requestSelectionAI(api(fetcher), {
        text: "selected",
        instruction: "Fix",
        signal: controller.signal,
      }),
    ).rejects.toThrow("aborted");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("passes the signal through so an in-flight request can be cancelled", async () => {
    const controller = new AbortController();
    const fetcher = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        }),
    );
    const request = requestSelectionAI(api(fetcher), {
      text: "selected",
      instruction: "Fix",
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());

    controller.abort();

    await expect(request).rejects.toThrow("aborted");
  });
});

it("continues a clarification with the original selection and assistant question", async () => {
  const fetcher = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      sseResponse(assistantChunks("Translations")),
  );
  let history: import("ai").UIMessage[] = [];
  await requestSelectionAI(api(fetcher), {
    text: "original",
    instruction: "Translate",
    onMessages: (messages) => {
      history = messages;
    },
  });
  await requestSelectionAI(api(fetcher), {
    text: "original",
    instruction: "Translate",
    history,
    clarification: "I meant they synchronized it.",
  });
  const body = JSON.parse(String(fetcher.mock.calls[1][1]?.body));
  expect(body.messages).toHaveLength(3);
  expect(body.messages[0].parts[0].text).toContain("original");
  expect(body.messages[1].role).toBe("assistant");
  expect(body.messages[1].parts[0].text).toBe("Translations");
  expect(body.messages[2].parts[0].text).toBe("I meant they synchronized it.");
});

it("reports the effective model from stream metadata", async () => {
  const chunks = [
    {
      type: "start",
      messageId: "assistant-1",
      messageMetadata: { model: "provider/fast-model" },
    },
    ...assistantChunks("Done").slice(1),
  ];
  const fetcher = vi.fn(async () => sseResponse(chunks));
  let model: string | undefined;
  await requestSelectionAI(api(fetcher), {
    text: "original",
    instruction: "Translate",
    onModel: (value) => {
      model = value;
    },
  });
  expect(model).toBe("provider/fast-model");
});

it("sends an explicitly selected enabled model to the server", async () => {
  const fetcher = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      sseResponse(assistantChunks("Done")),
  );
  await requestSelectionAI(api(fetcher), {
    text: "Original",
    instruction: "Translate",
    model: "provider/enabled-model",
  });
  expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body)).model).toBe(
    "provider/enabled-model",
  );
});

it("preserves the server policy error code when a model was disabled", async () => {
  const fetcher = vi.fn(async () =>
    Response.json(
      {
        error: {
          code: "ASSISTANT_MODEL_NOT_ALLOWED",
          message: "Disabled by admin",
        },
      },
      { status: 403 },
    ),
  );
  await expect(
    requestSelectionAI(api(fetcher), {
      text: "Source",
      instruction: "Translate",
      model: "provider/disabled",
    }),
  ).rejects.toMatchObject({
    code: "ASSISTANT_MODEL_NOT_ALLOWED",
    message: "Disabled by admin",
  });
});
