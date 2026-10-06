import { OpenAPIHono } from "@hono/zod-openapi";
import { describe, expect, it, vi } from "vitest";
import type {
  WhatsappDeliveryInput,
  WhatsappInboundInput,
} from "../src/whatsapp/inbound-contracts";
import { registerWhatsappWebhook } from "../src/whatsapp/webhook";

const appSecret = "meta-app-secret-for-tests";
const verifyToken = "meta-verify-token-for-tests";

async function signature(body: string, secret = appSecret) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(body),
  );
  return `sha256=${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function webhookBody(
  value: Record<string, unknown>,
  field = "messages",
  wabaId = "waba-123",
) {
  return JSON.stringify({
    object: "whatsapp_business_account",
    entry: [{ id: wabaId, changes: [{ field, value }] }],
  });
}

function messageValue(type = "text") {
  return {
    metadata: { phone_number_id: "phone-456" },
    messages: [
      {
        id: "wamid.1",
        from: "+15551234567",
        timestamp: "1791200000",
        type,
        ...(type === "text" ? { text: { body: "Hello Savia" } } : {}),
      },
    ],
  };
}

function setup(
  options: {
    receive?: (input: WhatsappInboundInput) => Promise<boolean>;
    receipt?: (input: WhatsappDeliveryInput) => Promise<void>;
    process?: () => Promise<unknown>;
    configured?: boolean;
    deferProcessing?: boolean;
  } = {},
) {
  const receive = vi.fn(options.receive ?? (async () => true));
  const receipt = vi.fn(options.receipt ?? (async () => undefined));
  const process = vi.fn(options.process ?? (async () => undefined));
  const app = new OpenAPIHono();
  registerWhatsappWebhook(app, {
    repository: { receive, receipt },
    ...(options.configured === false ? {} : { appSecret, verifyToken }),
    process,
    deferProcessing: options.deferProcessing,
  });
  return { app, receive, receipt, process };
}

async function post(app: OpenAPIHono, body: string, signedBody = body) {
  return app.request("/webhooks/whatsapp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-hub-signature-256": await signature(signedBody),
    },
    body,
  });
}

describe("WhatsApp webhook", () => {
  it("verifies Meta's GET challenge only with the configured token", async () => {
    const { app } = setup();
    const valid = await app.request(
      "/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=meta-verify-token-for-tests&hub.challenge=challenge-987",
    );
    expect(valid.status).toBe(200);
    expect(await valid.text()).toBe("challenge-987");

    const invalid = await app.request(
      "/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=challenge-987",
    );
    expect(invalid.status).toBe(403);
  });

  it("fails closed when either webhook secret is missing", async () => {
    const { app } = setup({ configured: false });
    expect(
      (
        await app.request(
          "/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=meta-verify-token-for-tests&hub.challenge=x",
        )
      ).status,
    ).toBe(503);
    expect((await post(app, webhookBody(messageValue()))).status).toBe(503);
  });

  it("authenticates exact raw POST bytes and persists signed text before acknowledging", async () => {
    const { app, receive } = setup();
    const raw =
      '{ "object":"whatsapp_business_account", "entry":[{"id":"waba-123","changes":[{"field":"messages","value":{"metadata":{"phone_number_id":"phone-456"},"messages":[{"id":"wamid.1","from":"+15551234567","timestamp":"1791200000","type":"text","text":{"body":"Hello Savia"}}]}}]}]}';
    const accepted = await post(app, raw);
    expect(accepted.status).toBe(200);
    expect(receive).toHaveBeenCalledExactlyOnceWith({
      phoneNumberId: "phone-456",
      wabaId: "waba-123",
      messageId: "wamid.1",
      contactPhone: "+15551234567",
      text: "Hello Savia",
      timestamp: "1791200000",
    });

    const altered = raw.replace("Hello Savia", "Hello Savia!");
    expect((await post(app, altered, raw)).status).toBe(401);
    expect(receive).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed JSON and streamed bodies larger than 256 KiB", async () => {
    const { app, receive } = setup();
    expect((await post(app, "not-json")).status).toBe(400);

    const bytes = new Uint8Array(256 * 1024 + 1).fill(32);
    const oversized = await app.request("/webhooks/whatsapp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": await signature(new TextDecoder().decode(bytes)),
      },
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      }),
    });
    expect(oversized.status).toBe(413);
    expect(receive).not.toHaveBeenCalled();
  });

  it("records supported delivery receipts and ignores unsupported events", async () => {
    const { app, receive, receipt } = setup();
    expect((await post(app, webhookBody(messageValue("sticker")))).status).toBe(
      200,
    );
    expect(receive).not.toHaveBeenCalled();

    const receiptBody = webhookBody({
      metadata: { phone_number_id: "phone-456" },
      statuses: [
        { id: "wamid.outbound", status: "delivered" },
        {
          id: "wamid.failed",
          status: "failed",
          errors: [{ code: 131047 }],
        },
      ],
    });
    expect((await post(app, receiptBody)).status).toBe(200);
    expect(receipt).toHaveBeenNthCalledWith(1, {
      phoneNumberId: "phone-456",
      wabaId: "waba-123",
      messageId: "wamid.outbound",
      status: "delivered",
    });
    expect(receipt).toHaveBeenNthCalledWith(2, {
      phoneNumberId: "phone-456",
      wabaId: "waba-123",
      messageId: "wamid.failed",
      status: "failed",
      errorCode: "131047",
    });
  });

  it("acknowledges duplicate events and does not schedule processing for them", async () => {
    const { app, receive, process } = setup({
      receive: async () => false,
    });
    expect((await post(app, webhookBody(messageValue()))).status).toBe(200);
    expect(receive).toHaveBeenCalledOnce();
    expect(process).not.toHaveBeenCalled();
  });

  it("persists accepted events without HTTP background generation in scheduled mode", async () => {
    const { app, receive, process } = setup({ deferProcessing: true });
    expect((await post(app, webhookBody(messageValue()))).status).toBe(200);
    expect(receive).toHaveBeenCalledOnce();
    expect(process).not.toHaveBeenCalled();
  });

  it("returns 503 when persistence fails instead of acknowledging", async () => {
    const { app, process } = setup({
      receive: async () => {
        throw new Error("database unavailable");
      },
    });
    expect((await post(app, webhookBody(messageValue()))).status).toBe(503);
    expect(process).not.toHaveBeenCalled();
  });

  it("returns 503 when a delivery receipt cannot be persisted", async () => {
    const { app } = setup({
      receipt: async () => {
        throw new Error("database unavailable");
      },
    });
    const body = webhookBody({
      metadata: { phone_number_id: "phone-456" },
      statuses: [{ id: "wamid.outbound", status: "read" }],
    });
    expect((await post(app, body)).status).toBe(503);
  });
});

it("durably accepts signed button replies without invoking Graph during ingestion", async () => {
  const { app, receive } = setup();
  const value = messageValue();
  value.messages = [
    {
      id: "wamid.choice",
      from: "+15551234567",
      timestamp: "1791200000",
      type: "interactive",
      interactive: {
        type: "button_reply",
        button_reply: { id: "services", title: "Servicios" },
      },
    },
  ] as unknown as typeof value.messages;
  expect((await post(app, webhookBody(value))).status).toBe(200);
  expect(receive).toHaveBeenCalledWith(
    expect.objectContaining({
      messageId: "wamid.choice",
      text: "Servicios",
      native: expect.objectContaining({ kind: "choice", id: "services" }),
    }),
  );
});
