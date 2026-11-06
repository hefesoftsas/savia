import { describe, it, expect, vi } from "vitest";
import { createGatewayActions } from "../src/gateway";
import { renderTemplate } from "../src/domain";
const context = {
  tenantId: "tenant",
  principalId: "user",
  extensionId: "insurance.communications",
  actionId: "send",
  connectionId: "main",
  runId: "run",
};
const args = {
  context,
  connection: {
    endpoint: "https://integration.example/execute",
    token: "secret-token-123",
  },
  input: {
    operationKey: "stable-key",
    payload: {
      recipient: "client@example.com",
      body: "Hello",
      consent: true,
      suppressed: false,
    },
  },
};
describe("guarded integrations", () => {
  it("retains idempotency and distinguishes accepted from delivered", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            reference: "ref",
            state: "accepted",
            extra: "secret-token-123",
          }),
        ),
    );
    const action = createGatewayActions(context.extensionId, ["send"], {
      allowedOrigins: ["https://integration.example"],
      fetcher,
    })[0];
    expect(await action.execute(args)).toEqual({
      reference: "ref",
      state: "accepted",
    });
    await action.execute(args);
    expect(
      fetcher.mock.calls.map(
        (call) => (call as unknown as [string, RequestInit])[1].headers,
      ),
    ).toEqual([
      expect.objectContaining({
        "Idempotency-Key": "tenant:insurance.communications:send:stable-key",
      }),
      expect.objectContaining({
        "Idempotency-Key": "tenant:insurance.communications:send:stable-key",
      }),
    ]);
  });
  it("fails closed without allowed origin", async () => {
    await expect(
      createGatewayActions(context.extensionId, ["send"])[0].execute(args),
    ).rejects.toThrow("no autorizado");
  });
  it.each(["network", "malformed", "secret", "http"])(
    "does not report success for %s",
    async (kind) => {
      const fetcher = vi.fn(async () => {
        if (kind === "network") throw Error("secret-token-123");
        return new Response(
          JSON.stringify(
            kind === "malformed"
              ? {}
              : {
                  reference: kind === "secret" ? "secret-token-123" : "ref",
                  state: "accepted",
                },
          ),
          { status: kind === "http" ? 500 : 200 },
        );
      });
      await expect(
        createGatewayActions(context.extensionId, ["send"], {
          allowedOrigins: ["https://integration.example"],
          fetcher,
        })[0].execute(args),
      ).rejects.not.toThrow("secret-token-123");
    },
  );
  it("blocks suppressed or nonconsenting recipients", async () => {
    await expect(
      createGatewayActions(context.extensionId, ["send"], {
        allowedOrigins: ["https://integration.example"],
      })[0].execute({
        ...args,
        input: { ...args.input, payload: { consent: true, suppressed: true } },
      }),
    ).rejects.toThrow("consentimiento");
  });
  it("requires all template variables", () => {
    expect(renderTemplate("Hola {{name}}", { name: "Ana" })).toBe("Hola Ana");
    expect(() => renderTemplate("{{missing}}", {})).toThrow();
  });
});
it("rejects oversized receipts without persisting provider output", async () => {
  const fetcher = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          reference: "ref",
          state: "accepted",
          padding: "x".repeat(65537),
        }),
      ),
  );
  await expect(
    createGatewayActions(context.extensionId, ["send"], {
      allowedOrigins: ["https://integration.example"],
      fetcher,
    })[0].execute(args),
  ).rejects.toThrow("Respuesta inválida");
});
it("rejects mismatched execution context before any network request", async () => {
  const fetcher = vi.fn();
  await expect(
    createGatewayActions(context.extensionId, ["send"], {
      allowedOrigins: ["https://integration.example"],
      fetcher,
    })[0].execute({ ...args, context: { ...context, actionId: "status" } }),
  ).rejects.toThrow("Contexto");
  expect(fetcher).not.toHaveBeenCalled();
});
it("retains signature evidence while rejecting unsafe evidence links", async () => {
  const fetcher = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          reference: "sig",
          state: "delivered",
          signedAt: "2026-09-19T10:00:00Z",
          evidenceUrl: "https://evidence.example/proof",
        }),
      ),
  );
  const action = createGatewayActions(context.extensionId, ["send"], {
    allowedOrigins: ["https://integration.example"],
    fetcher,
  })[0];
  expect(await action.execute(args)).toMatchObject({
    signedAt: "2026-09-19T10:00:00Z",
    evidenceUrl: "https://evidence.example/proof",
  });
  fetcher.mockImplementation(
    async () =>
      new Response(
        JSON.stringify({
          reference: "sig",
          state: "delivered",
          evidenceUrl: "http://unsafe.example",
        }),
      ),
  );
  await expect(action.execute(args)).rejects.toThrow("no seguro");
});
it("validates action payloads before contacting a provider", async () => {
  const fetcher = vi.fn();
  for (const [extensionId, actionId, payload] of [
    ["insurance.communications", "send", { consent: true, suppressed: false }],
    [
      "insurance.calendar",
      "sync",
      {
        id: "event",
        title: "Meeting",
        start: "2026-09-20T10:00:00Z",
        end: "2026-09-20T11:00:00+99:99",
        timeZone: "UTC",
      },
    ],
    ["insurance.carriers", "request-issuance", { carrier: "", policy: "" }],
    [
      "insurance.document-generation",
      "request-signature",
      { documentId: "doc", fileId: "file", recipient: "invalid" },
    ],
  ] as const) {
    await expect(
      createGatewayActions(extensionId, [actionId], {
        allowedOrigins: ["https://integration.example"],
        fetcher,
      })[0].execute({
        ...args,
        context: { ...context, extensionId, actionId },
        input: { operationKey: "stable-key", payload },
      }),
    ).rejects.toThrow();
  }
  expect(fetcher).not.toHaveBeenCalled();
});
it("registers the same payload validation for API actions", async () => {
  const { runtime } = await import("../src/gateway");
  const input = runtime("insurance.calendar", ["sync"]).actions[0].inputSchema;
  expect(
    input.safeParse({
      operationKey: "stable-key",
      payload: {
        id: "event",
        title: "Meeting",
        start: "2026-02-28T10:00:00Z",
        end: "2026-02-30T11:00:00Z",
        timeZone: "UTC",
      },
    }).success,
  ).toBe(false);
  expect(
    input.safeParse({
      operationKey: "stable-key",
      payload: {
        id: "event",
        title: "Meeting",
        start: "2026-02-28T10:00:00Z",
        end: "2026-02-28T11:00:00Z",
        timeZone: "UTC",
      },
    }).success,
  ).toBe(true);
});
