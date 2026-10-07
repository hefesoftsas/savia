import { afterEach, expect, it, vi } from "vitest";
import {
  diagnosticErrorCode,
  logWhatsappDiagnostic,
  traceWhatsappOperation,
} from "../src/whatsapp/diagnostics";

afterEach(() => vi.restoreAllMocks());

it("logs correlated durations and outcomes without operation inputs or results", async () => {
  const info = vi.spyOn(console, "info").mockImplementation(() => {});
  const result = { privateApplicant: "PRIVATE_PERSON" };
  expect(
    await traceWhatsappOperation(
      { message_id: "message", generation: "cycle" },
      "quote_catalog",
      async () => result,
    ),
  ).toBe(result);
  const logs = info.mock.calls.map(([line]) => JSON.parse(String(line)));
  expect(logs).toMatchObject([
    {
      event: "whatsapp_operation",
      message_id: "message",
      operation: "quote_catalog",
      outcome: "started",
    },
    { outcome: "completed", duration_ms: expect.any(Number) },
  ]);
  expect(logs[1].duration_ms).toBeGreaterThanOrEqual(0);
  expect(JSON.stringify(logs)).not.toContain("PRIVATE_PERSON");
});

it("reports bounded error categories and rethrows the original failure", async () => {
  const info = vi.spyOn(console, "info").mockImplementation(() => {});
  const error = new Error("PRIVATE_PLATE private token");
  error.name = "PRIVATE_PERSON";
  await expect(
    traceWhatsappOperation(
      { message_id: "message" },
      "quote_catalog",
      async () => {
        throw error;
      },
    ),
  ).rejects.toBe(error);
  expect(JSON.parse(String(info.mock.calls.at(-1)?.[0]))).toMatchObject({
    outcome: "failed",
    error_code: "operation_failed",
  });
  expect(JSON.stringify(info.mock.calls)).not.toMatch(/PRIVATE_|private token/);
  expect(diagnosticErrorCode(new DOMException("secret", "TimeoutError"))).toBe(
    "timeout",
  );
});

it("whitelists fields and makes logging failure nonfatal", async () => {
  const info = vi.spyOn(console, "info").mockImplementation(() => {});
  logWhatsappDiagnostic(
    "whatsapp_operation",
    { message_id: "message", phone: "PRIVATE_PHONE" } as any,
    { stage: "model", prompt: "PRIVATE_PROMPT" } as any,
  );
  expect(String(info.mock.calls[0][0])).not.toMatch(/PRIVATE_/);
  info.mockImplementation(() => {
    throw new Error("logger unavailable");
  });
  expect(
    await traceWhatsappOperation({}, "quote_catalog", async () => "success"),
  ).toBe("success");
});

it("reports HTTP failures without URLs or response bodies and preserves the response", async () => {
  const info = vi.spyOn(console, "info").mockImplementation(() => {});
  const response = new Response("PRIVATE_RESPONSE", { status: 503 });
  expect(
    await traceWhatsappOperation(
      { action_id: "action" },
      "backend_request",
      async () => response,
    ),
  ).toBe(response);
  const logs = info.mock.calls.map(([line]) => JSON.parse(String(line)));
  expect(logs[1]).toMatchObject({
    outcome: "failed",
    http_status: 503,
    error_code: "http_error",
    call_id: logs[0].call_id,
  });
  expect(JSON.stringify(logs)).not.toContain("PRIVATE_RESPONSE");
});

it("keeps only an upstream error's HTTP status", async () => {
  const info = vi.spyOn(console, "info").mockImplementation(() => {});
  const failure = Object.assign(new Error("PRIVATE_PROVIDER_BODY"), {
    statusCode: 429,
    responseBody: "PRIVATE_BODY",
  });
  await expect(
    traceWhatsappOperation({}, "model_and_tools", async () => {
      throw failure;
    }),
  ).rejects.toBe(failure);
  expect(JSON.parse(String(info.mock.calls.at(-1)?.[0]))).toMatchObject({
    error_code: "http_error",
    http_status: 429,
  });
  expect(JSON.stringify(info.mock.calls)).not.toMatch(/PRIVATE_/);
});
