import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import type {
  WhatsappDeliveryInput,
  WhatsappInboundInput,
} from "./inbound-contracts";

const maxBodyBytes = 256 * 1024;
const deliveryStatuses = new Set<WhatsappDeliveryInput["status"]>([
  "sent",
  "delivered",
  "read",
  "failed",
]);

type WebhookRepository = {
  receive(input: WhatsappInboundInput): Promise<boolean>;
  receipt(input: WhatsappDeliveryInput): Promise<void>;
};

export type WhatsappWebhookDependencies = {
  repository: WebhookRepository;
  appSecret?: string;
  verifyToken?: string;
  process?: () => Promise<unknown>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonemptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function decodeSignature(value: string | undefined): Uint8Array | undefined {
  if (!value || !/^sha256=[0-9a-f]{64}$/i.test(value)) return undefined;
  const hex = value.slice(7);
  return Uint8Array.from({ length: 32 }, (_, index) =>
    Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16),
  );
}

async function readBoundedBody(
  request: Request,
): Promise<
  { bytes: Uint8Array; status?: never } | { bytes?: never; status: 400 | 413 }
> {
  const length = request.headers.get("content-length");
  if (length && /^\d+$/.test(length) && Number(length) > maxBodyBytes)
    return { status: 413 };
  if (!request.body) return { status: 400 };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBodyBytes) {
        await reader.cancel();
        return { status: 413 };
      }
      chunks.push(value);
    }
  } catch {
    return { status: 400 };
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { bytes };
}

async function isAuthentic(
  body: Uint8Array,
  header: string | undefined,
  secret: string,
): Promise<boolean> {
  const signature = decodeSignature(header);
  if (!signature) return false;
  try {
    const signatureBuffer = new ArrayBuffer(signature.byteLength);
    new Uint8Array(signatureBuffer).set(signature);
    const bodyBuffer = new ArrayBuffer(body.byteLength);
    new Uint8Array(bodyBuffer).set(body);
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
    return await crypto.subtle.verify("HMAC", key, signatureBuffer, bodyBuffer);
  } catch {
    return false;
  }
}

function parsePayload(bytes: Uint8Array): Record<string, unknown> | undefined {
  try {
    const payload: unknown = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
    if (
      !isRecord(payload) ||
      payload.object !== "whatsapp_business_account" ||
      !Array.isArray(payload.entry)
    )
      return undefined;
    for (const entry of payload.entry) {
      if (
        !isRecord(entry) ||
        !nonemptyString(entry.id) ||
        !Array.isArray(entry.changes)
      )
        return undefined;
      for (const change of entry.changes) {
        if (
          !isRecord(change) ||
          !nonemptyString(change.field) ||
          !isRecord(change.value)
        )
          return undefined;
      }
    }
    return payload;
  } catch {
    return undefined;
  }
}

function registerDocumentation(app: OpenAPIHono) {
  const getRoute = createRoute({
    method: "get",
    path: "/webhooks/whatsapp",
    tags: ["WhatsApp"],
    summary: "Verify Meta WhatsApp webhook subscription",
    security: [],
    request: {
      query: z.object({
        "hub.mode": z.string(),
        "hub.verify_token": z.string(),
        "hub.challenge": z.string(),
      }),
    },
    responses: {
      200: { description: "Meta webhook challenge" },
      403: { description: "Webhook verification token rejected" },
      503: { description: "Webhook verification is not configured" },
    },
  });
  const postRoute = createRoute({
    method: "post",
    path: "/webhooks/whatsapp",
    tags: ["WhatsApp"],
    summary: "Accept Meta WhatsApp messages and delivery receipts",
    security: [],
    description:
      "Requires X-Hub-Signature-256 over the exact raw request body. Accepts JSON bodies up to 256 KiB.",
    request: {
      headers: z.object({ "x-hub-signature-256": z.string() }),
      body: {
        required: true,
        content: {
          "application/json": { schema: z.record(z.string(), z.unknown()) },
        },
      },
    },
    responses: {
      200: { description: "Events durably accepted" },
      400: { description: "Malformed webhook payload" },
      401: { description: "Webhook signature rejected" },
      413: { description: "Request body exceeds 256 KiB" },
      503: { description: "Webhook is not configured or persistence failed" },
    },
  });
  app.openAPIRegistry.registerPath(getRoute);
  app.openAPIRegistry.registerPath(postRoute);
}

export function registerWhatsappWebhook(
  app: OpenAPIHono,
  deps: WhatsappWebhookDependencies,
): void {
  registerDocumentation(app);

  app.get("/webhooks/whatsapp", (c) => {
    if (!deps.appSecret || !deps.verifyToken)
      return c.text("Webhook is not configured", 503);
    const query = c.req.query();
    if (
      query["hub.mode"] !== "subscribe" ||
      query["hub.verify_token"] !== deps.verifyToken ||
      !nonemptyString(query["hub.challenge"])
    )
      return c.text("Forbidden", 403);
    return c.text(query["hub.challenge"], 200);
  });

  app.post("/webhooks/whatsapp", async (c) => {
    if (!deps.appSecret || !deps.verifyToken)
      return c.text("Webhook is not configured", 503);

    const body = await readBoundedBody(c.req.raw);
    if (body.status === 413) return c.text("Payload too large", 413);
    if (!body.bytes) return c.text("Invalid webhook body", 400);
    if (
      !(await isAuthentic(
        body.bytes,
        c.req.header("x-hub-signature-256"),
        deps.appSecret,
      ))
    )
      return c.text("Invalid webhook signature", 401);

    const payload = parsePayload(body.bytes);
    if (!payload) return c.text("Invalid webhook payload", 400);

    let acceptedInbound = false;
    try {
      for (const entry of payload.entry as Record<string, unknown>[]) {
        const wabaId = entry.id as string;
        for (const change of entry.changes as Record<string, unknown>[]) {
          if (change.field !== "messages") continue;
          const value = change.value as Record<string, unknown>;
          const metadata = value.metadata;
          const messages = value.messages;
          const statuses = value.statuses;
          if (
            (messages !== undefined && !Array.isArray(messages)) ||
            (statuses !== undefined && !Array.isArray(statuses))
          )
            return c.text("Invalid webhook payload", 400);
          if (!Array.isArray(messages) && !Array.isArray(statuses)) continue;
          if (!isRecord(metadata) || !nonemptyString(metadata.phone_number_id))
            return c.text("Invalid webhook payload", 400);
          const phoneNumberId = metadata.phone_number_id;

          for (const message of (messages ?? []) as unknown[]) {
            if (!isRecord(message) || !nonemptyString(message.type))
              return c.text("Invalid webhook payload", 400);
            if (message.type !== "text") continue;
            if (
              !nonemptyString(message.id) ||
              !nonemptyString(message.from) ||
              !nonemptyString(message.timestamp) ||
              !isRecord(message.text) ||
              typeof message.text.body !== "string"
            )
              return c.text("Invalid webhook payload", 400);
            acceptedInbound =
              (await deps.repository.receive({
                phoneNumberId,
                wabaId,
                messageId: message.id,
                contactPhone: message.from,
                text: message.text.body,
                timestamp: message.timestamp,
              })) || acceptedInbound;
          }

          for (const status of (statuses ?? []) as unknown[]) {
            if (!isRecord(status))
              return c.text("Invalid webhook payload", 400);
            if (
              typeof status.status !== "string" ||
              !deliveryStatuses.has(
                status.status as WhatsappDeliveryInput["status"],
              )
            )
              continue;
            if (!nonemptyString(status.id))
              return c.text("Invalid webhook payload", 400);
            const errors = status.errors;
            if (errors !== undefined && !Array.isArray(errors))
              return c.text("Invalid webhook payload", 400);
            const firstError = Array.isArray(errors) ? errors[0] : undefined;
            const errorCode = isRecord(firstError)
              ? firstError.code
              : undefined;
            await deps.repository.receipt({
              phoneNumberId,
              wabaId,
              messageId: status.id,
              status: status.status as WhatsappDeliveryInput["status"],
              ...(typeof errorCode === "number" || typeof errorCode === "string"
                ? { errorCode: String(errorCode) }
                : {}),
            });
          }
        }
      }
    } catch {
      return c.text("Could not persist webhook events", 503);
    }

    if (acceptedInbound && deps.process) {
      let waitUntil: ((promise: Promise<unknown>) => void) | undefined;
      try {
        waitUntil = c.executionCtx?.waitUntil.bind(c.executionCtx);
      } catch {
        // Local route tests can run without a Workers execution context.
      }
      const work = Promise.resolve().then(() => deps.process!());
      if (waitUntil) waitUntil(work.catch(() => undefined));
      else void work.catch(() => undefined);
    }

    return c.text("EVENT_RECEIVED", 200);
  });
}
