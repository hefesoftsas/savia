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
function assistant() {
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
