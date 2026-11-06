import { afterEach, expect, it, vi } from "vitest";
const sdk = vi.hoisted(() => vi.fn());
vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ai")>()),
  generateText: sdk,
}));
import { createWhatsappAssistant } from "../src/whatsapp/assistant";

afterEach(() => {
  vi.restoreAllMocks();
  sdk.mockReset();
});

const binding = {
  tenantId: 7,
  employeeId: "employee",
  ownerPrincipalId: "owner",
} as any;
function assistant(overrides: Record<string, unknown> = {}) {
  return createWhatsappAssistant({
    configuration: {
      effectiveConfigurationForTenant: async () => ({
        apiKey: "PRIVATE_KEY",
        tenantId: 7,
        model: "test/model",
      }),
    } as any,
    employees: {
      getById: async () => ({
        id: "employee",
        agencyId: 7,
        status: "active",
        name: "Alice",
        allowedCollections: [],
        systemPrompt: "PRIVATE_PROMPT",
      }),
    } as any,
    knowledge: async () => [],
    ...overrides,
  });
}

it("separates model time and token counts from tools without logging prompts or content", async () => {
  const info = vi.spyOn(console, "info").mockImplementation(() => {});
  sdk.mockImplementation(async (options) => {
    options.onLanguageModelCallStart({
      callId: "model-call",
      prompt: "PRIVATE_PROMPT",
    });
    options.onLanguageModelCallEnd({
      callId: "model-call",
      usage: { inputTokens: 101, outputTokens: 42 },
      performance: { responseTimeMs: 123 },
      content: "PRIVATE_RESPONSE",
    });
    return { text: "PRIVATE_RESPONSE" };
  });
  expect(
    await assistant()(binding, [], "PRIVATE_MESSAGE", {
      messageId: "message",
    } as any),
  ).toBe("PRIVATE_RESPONSE");
  const logs = info.mock.calls.map(([line]) => JSON.parse(String(line)));
  expect(logs).toContainEqual(
    expect.objectContaining({
      event: "whatsapp_model_call",
      message_id: "message",
      call_id: "model-call",
      outcome: "completed",
      duration_ms: 123,
      input_tokens: 101,
      output_tokens: 42,
    }),
  );
  expect(JSON.stringify(logs)).not.toMatch(/PRIVATE_/);
});

it("disables reasoning and stops when a verified server reply is ready", async () => {
  let ready = false;
  const reply = vi.fn(() =>
    ready ? "Verified server confirmation" : undefined,
  );
  sdk.mockImplementation(async (options) => {
    expect(options.providerOptions).toEqual({
      openrouter: { reasoning: { effort: "none", exclude: true } },
    });
    expect(options.prepareStep({ stepNumber: 3 })).toEqual({});
    expect(options.prepareStep({ stepNumber: 4 })).toEqual({
      toolChoice: "none",
    });
    expect(options.stopWhen.some((stop: Function) => stop({ steps: [] }))).toBe(
      false,
    );
    ready = true;
    expect(options.stopWhen.some((stop: Function) => stop({ steps: [] }))).toBe(
      true,
    );
    return { text: "" };
  });
  expect(
    await assistant({
      capabilities: async () => ({
        tools: { verified_tool: {} },
        system: "",
        reply,
      }),
    })(binding, [], "Continue"),
  ).toBe("Verified server confirmation");
});

it("uses a prepared server reply if the following model call times out", async () => {
  let ready = false;
  sdk.mockImplementation(async () => {
    ready = true;
    throw new DOMException("PRIVATE_DETAILS", "TimeoutError");
  });
  expect(
    await assistant({
      capabilities: async () => ({
        tools: {},
        system: "",
        reply: () => (ready ? "Verified server confirmation" : undefined),
      }),
    })(binding, [], "Continue"),
  ).toBe("Verified server confirmation");
});

it("logs an interrupted model call and propagates the original timeout", async () => {
  const info = vi.spyOn(console, "info").mockImplementation(() => {});
  const failure = new DOMException("PRIVATE_DETAILS", "TimeoutError");
  sdk.mockImplementation(async (options) => {
    options.onLanguageModelCallStart({ callId: "timeout-call" });
    throw failure;
  });
  await expect(
    assistant()(binding, [], "PRIVATE_MESSAGE", {
      messageId: "message",
    } as any),
  ).rejects.toBe(failure);
  const logs = info.mock.calls.map(([line]) => JSON.parse(String(line)));
  expect(logs).toContainEqual(
    expect.objectContaining({
      event: "whatsapp_model_call",
      call_id: "timeout-call",
      outcome: "failed",
      error_code: "timeout",
    }),
  );
  expect(logs).toContainEqual(
    expect.objectContaining({
      event: "whatsapp_operation",
      operation: "model_and_tools",
      outcome: "failed",
      error_code: "timeout",
    }),
  );
  expect(JSON.stringify(logs)).not.toMatch(/PRIVATE_/);
});

it("bounds recent context without trimming the current message or changing stored history", async () => {
  const history = Array.from({ length: 20 }, (_, index) => ({
    role: index % 2 ? ("assistant" as const) : ("user" as const),
    content: `${index}:` + "x".repeat(4096),
  }));
  const stored = structuredClone(history);
  const current = "Current user input " + "y".repeat(9000);
  const completion = vi.fn(async (input) => {
    const context = input.messages.slice(0, -1);
    expect(context.length).toBeLessThanOrEqual(12);
    expect(
      context.reduce(
        (total: number, entry: { content: string }) =>
          total + entry.content.length,
        0,
      ),
    ).toBeLessThanOrEqual(8000);
    expect(context.at(-1)).toEqual({
      role: "assistant",
      content: stored.at(-1)!.content.slice(0, 1024),
    });
    expect(context.at(-2).content).toBe(stored.at(-2)!.content.slice(0, 4096));
    expect(input.messages.at(-1)).toEqual({ role: "user", content: current });
    return "Answer";
  });
  expect(
    await assistant({ complete: completion })(binding, history, current),
  ).toBe("Answer");
  expect(history).toEqual(stored);
});
