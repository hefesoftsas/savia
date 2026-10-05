import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import { actorFromContext } from "../auth/middleware";
import { canManageWhatsappAssistant } from "./assistant-routes";
import type { WhatsappNangoClient } from "./contracts";
import { WhatsappInboundRepository } from "./inbound-repository";
import { uploadWhatsappMedia } from "./media";
import {
  buildNativeMessage,
  defaultNativeConfiguration,
  nativeConfigurationSchema,
  nativeReplySchema,
  sendNativeMessage,
  type NativeReply,
} from "./native";

const tenantQuery = z.object({ agencyId: z.coerce.number().int().positive() });
const recipient = z
  .string()
  .max(32)
  .transform((value) => value.trim().replace(/\s/g, "").replace(/^\+/, ""))
  .pipe(z.string().regex(/^[1-9]\d{6,14}$/));
const configurationInput = z
  .object({
    agencyId: z.number().int().positive(),
    configuration: nativeConfigurationSchema,
  })
  .strict();
const replyInput = z
  .object({
    agencyId: z.number().int().positive(),
    to: recipient,
    reply: nativeReplySchema,
    idempotencyKey: z.string().uuid(),
    consent: z.boolean().default(false),
  })
  .strict();
const uploadBody = z.object({
  file: z.any().openapi({ type: "string", format: "binary" }),
});

const errorResult = z.object({ error: z.string() });
const configurationResult = z.object({ data: nativeConfigurationSchema });
const settingsResult = z.object({
  data: z.object({
    configuration: nativeConfigurationSchema,
    configured: z.boolean(),
    contributions: z.array(z.unknown()),
  }),
});
const assetsResult = z.object({
  data: z.object({
    flows: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        status: z.literal("PUBLISHED"),
      }),
    ),
    templates: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        language: z.string(),
        status: z.literal("APPROVED"),
        parameterCount: z.number().int().nonnegative(),
        supported: z.boolean(),
      }),
    ),
  }),
});
const sendResult = z.object({ data: z.object({ messageId: z.string() }) });
const uploadResult = z.object({
  data: z.object({
    mediaId: z.string(),
    type: z.string(),
    filename: z.string(),
  }),
});
function standardResponses(result: z.ZodTypeAny) {
  return {
    200: {
      description: "WhatsApp native operation completed",
      content: { "application/json": { schema: result } },
    },
    400: {
      description: "Invalid native input",
      content: { "application/json": { schema: errorResult } },
    },
    403: {
      description: "Tenant administrator or allowed recipient required",
      content: { "application/json": { schema: errorResult } },
    },
    409: {
      description: "Connection, reply window or send state unavailable",
      content: { "application/json": { schema: errorResult } },
    },
    413: {
      description: "Uploaded media exceeds the bounded request size",
      content: { "application/json": { schema: errorResult } },
    },
    422: {
      description: "Native resource is unavailable or unapproved",
      content: { "application/json": { schema: errorResult } },
    },
    502: {
      description: "Provider request failed or has an uncertain outcome",
      content: { "application/json": { schema: errorResult } },
    },
  } as const;
}

const getConfigurationRoute = createRoute({
  method: "get",
  path: "/v1/whatsapp/native",
  tags: ["WhatsApp"],
  summary: "Read native WhatsApp tenant configuration",
  security: [{ oauth2: ["savia.api.read"] }],
  request: { query: tenantQuery },
  responses: standardResponses(settingsResult),
});

const putConfigurationRoute = createRoute({
  method: "put",
  path: "/v1/whatsapp/native",
  tags: ["WhatsApp"],
  summary: "Configure approved native WhatsApp resources",
  security: [{ oauth2: ["savia.api.write"] }],
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: configurationInput } },
    },
  },
  responses: standardResponses(configurationResult),
});

const assetsRoute = createRoute({
  method: "get",
  path: "/v1/whatsapp/native/assets",
  tags: ["WhatsApp"],
  summary: "Discover published WhatsApp Flows and approved templates",
  security: [{ oauth2: ["savia.api.read"] }],
  request: { query: tenantQuery },
  responses: standardResponses(assetsResult),
});

const sendRoute = createRoute({
  method: "post",
  path: "/v1/whatsapp/native/messages",
  tags: ["WhatsApp"],
  summary: "Send one tenant-approved native WhatsApp message",
  security: [{ oauth2: ["savia.api.write"] }],
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: replyInput } },
    },
  },
  responses: standardResponses(sendResult),
});

const uploadRoute = createRoute({
  method: "post",
  path: "/v1/whatsapp/native/media",
  tags: ["WhatsApp"],
  summary: "Upload media to the tenant's WhatsApp account",
  security: [{ oauth2: ["savia.api.write"] }],
  request: {
    query: tenantQuery,
    body: {
      required: true,
      content: { "multipart/form-data": { schema: uploadBody } },
    },
  },
  responses: standardResponses(uploadResult),
});

const MAX_MEDIA_BYTES = 8 * 1024 * 1024;
const MAX_MULTIPART_BYTES = MAX_MEDIA_BYTES + 64 * 1024;
const REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;

type ReplyWindow = { open: boolean; inboundMessageId?: string };

async function readReplyWindow(
  db: D1Database,
  connectionId: string,
  contact: string,
): Promise<ReplyWindow> {
  const latest = await db
    .prepare(
      `SELECT message_id,provider_timestamp FROM whatsapp_inbox
       WHERE connection_id=? AND normalized_contact=?
       ORDER BY provider_timestamp DESC,received_at DESC,message_id DESC LIMIT 1`,
    )
    .bind(connectionId, contact)
    .first<{ message_id: string; provider_timestamp: string }>();
  if (!latest) return { open: false };
  const timestamp = Date.parse(latest.provider_timestamp);
  const age = Date.now() - timestamp;
  return {
    open:
      Number.isFinite(age) &&
      age <= REPLY_WINDOW_MS &&
      age >= -MAX_FUTURE_SKEW_MS,
    inboundMessageId: latest.message_id,
  };
}

async function readBoundedMultipartBody(
  request: Request,
): Promise<{ bytes?: Uint8Array; status?: 400 | 413 }> {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    if (!/^\d+$/.test(contentLength)) return { status: 400 };
    if (Number(contentLength) > MAX_MULTIPART_BYTES) return { status: 413 };
  }
  if (!request.body) return { status: 400 };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_MULTIPART_BYTES) {
        void reader.cancel().catch(() => undefined);
        return { status: 413 };
      }
      chunks.push(value);
    }
  } catch {
    return { status: 400 };
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // A cancelled stream may still have a pending read.
    }
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { bytes };
}

async function readProviderJson(response: Response): Promise<unknown> {
  return response.json().catch(() => undefined);
}

function providerRows(value: unknown): Record<string, unknown>[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const data = (value as Record<string, unknown>).data;
  return Array.isArray(data)
    ? data.filter(
        (row): row is Record<string, unknown> =>
          row !== null && typeof row === "object" && !Array.isArray(row),
      )
    : [];
}

function supportedTemplate(value: Record<string, unknown>) {
  const components = Array.isArray(value.components)
    ? (value.components as Record<string, unknown>[])
    : [];
  const body = components.find((component) => component.type === "BODY");
  const typesSupported =
    components.length > 0 &&
    components.every((component) =>
      ["BODY", "FOOTER"].includes(String(component.type)),
    );
  const bodyText = typeof body?.text === "string" ? body.text : "";
  const tokens = bodyText.match(/\{\{[^{}]+\}\}/g) ?? [];
  const indexes = bodyText.match(/\{\{\d+\}\}/g) ?? [];
  const numbers = indexes.map((token) => Number(token.slice(2, -2)));
  const contiguous =
    tokens.length === indexes.length &&
    new Set(numbers).size === numbers.length &&
    numbers
      .sort((a, b) => a - b)
      .every((number, index) => number === index + 1);
  const footerUnsupported = components.some(
    (component) =>
      component.type === "FOOTER" &&
      (typeof component.text !== "string" ||
        /\{\{[^{}]+\}\}/.test(component.text)),
  );
  return {
    parameterCount: numbers.length,
    supported:
      typesSupported && body !== undefined && contiguous && !footerUnsupported,
  };
}

function isNativeResourceError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message === "WHATSAPP_NATIVE_RESOURCE_UNAVAILABLE"
  );
}

export function registerWhatsappNativeRoutes(
  app: OpenAPIHono,
  db: D1Database,
  nango: WhatsappNangoClient,
  contributions: readonly unknown[] = [],
) {
  const repository = new WhatsappInboundRepository(db);

  app.openapi(getConfigurationRoute, async (context) => {
    const tenantId = context.req.valid("query").agencyId;
    if (!canManageWhatsappAssistant(actorFromContext(context), tenantId))
      return context.json({ error: "Tenant administrator required" }, 403);
    const settings = await repository.getSettings(tenantId);
    return context.json(
      {
        data: {
          configuration: settings?.native ?? defaultNativeConfiguration,
          configured: Boolean(settings),
          contributions,
        },
      },
      200,
    );
  });

  app.openapi(putConfigurationRoute, async (context) => {
    const { agencyId, configuration } = context.req.valid("json");
    const actor = actorFromContext(context);
    if (!canManageWhatsappAssistant(actor, agencyId))
      return context.json({ error: "Tenant administrator required" }, 403);
    const settings = await repository.getSettings(agencyId);
    if (!settings)
      return context.json(
        { error: "Assign an assistant before configuring native resources" },
        409,
      );
    try {
      await repository.configure({
        ...settings,
        native: configuration,
        updatedBy: actor.principal.id,
      });
    } catch {
      return context.json(
        { error: "Assistant configuration is unavailable" },
        409,
      );
    }
    return context.json({ data: configuration }, 200);
  });

  app.openapi(assetsRoute, async (context) => {
    const tenantId = context.req.valid("query").agencyId;
    if (!canManageWhatsappAssistant(actorFromContext(context), tenantId))
      return context.json({ error: "Tenant administrator required" }, 403);
    const settings = await repository.getSettings(tenantId);
    if (!settings)
      return context.json({ error: "Assign an assistant first" }, 409);
    const row = await db
      .prepare(
        `SELECT phone_number_id,waba_id FROM tenant_whatsapp_connections
         WHERE id=? AND tenant_id=? AND status='connected' AND disconnected_at IS NULL`,
      )
      .bind(settings.connectionId, tenantId)
      .first<{ phone_number_id: string; waba_id: string }>();
    const binding =
      row?.phone_number_id && row.waba_id
        ? await repository.resolve(row.phone_number_id, row.waba_id)
        : undefined;
    if (!binding || binding.tenantId !== tenantId)
      return context.json(
        { error: "Enable a connected assistant to discover resources" },
        409,
      );
    const wabaId = binding.connection.wabaId;
    if (!wabaId) return context.json({ error: "WABA is unavailable" }, 409);
    try {
      const responses = await Promise.all([
        nango.proxy({
          connection: binding.connection,
          method: "GET",
          path: `/v21.0/${wabaId}/flows?fields=id,name,status,endpoint_uri&limit=100`,
        }),
        nango.proxy({
          connection: binding.connection,
          method: "GET",
          path: `/v21.0/${wabaId}/message_templates?fields=id,name,language,status,components&limit=100`,
        }),
      ]);
      if (responses.some((response) => !response.ok))
        return context.json({ error: "Meta resource discovery failed" }, 502);
      const [flowPayload, templatePayload] = await Promise.all(
        responses.map(readProviderJson),
      );
      const flows = providerRows(flowPayload)
        .filter(
          (flow) =>
            flow.status === "PUBLISHED" &&
            typeof flow.id === "string" &&
            typeof flow.name === "string" &&
            (flow.endpoint_uri === undefined ||
              flow.endpoint_uri === null ||
              flow.endpoint_uri === ""),
        )
        .map((flow) => ({ id: flow.id, name: flow.name, status: flow.status }));
      const templates = providerRows(templatePayload)
        .filter(
          (template) =>
            template.status === "APPROVED" &&
            typeof template.id === "string" &&
            typeof template.name === "string" &&
            typeof template.language === "string",
        )
        .map((template) => ({
          id: template.id,
          name: template.name,
          language: template.language,
          status: template.status,
          ...supportedTemplate(template),
        }));
      return context.json({ data: { flows, templates } }, 200);
    } catch {
      return context.json({ error: "Meta resource discovery failed" }, 502);
    }
  });

  app.openapi(sendRoute, async (context) => {
    const { agencyId, to, reply, idempotencyKey, consent } =
      context.req.valid("json");
    if (!canManageWhatsappAssistant(actorFromContext(context), agencyId))
      return context.json({ error: "Tenant administrator required" }, 403);
    const settings = await repository.getSettings(agencyId);
    if (!settings)
      return context.json({ error: "Assign an assistant first" }, 409);
    const connectionRow = await db
      .prepare(
        `SELECT phone_number_id,waba_id FROM tenant_whatsapp_connections
         WHERE id=? AND tenant_id=? AND status='connected' AND disconnected_at IS NULL`,
      )
      .bind(settings.connectionId, agencyId)
      .first<{ phone_number_id: string; waba_id: string }>();
    const binding =
      connectionRow?.phone_number_id && connectionRow.waba_id
        ? await repository.resolve(
            connectionRow.phone_number_id,
            connectionRow.waba_id,
          )
        : undefined;
    if (
      !binding ||
      binding.tenantId !== agencyId ||
      !binding.allowedContacts.includes(to)
    )
      return context.json(
        { error: "Recipient is not an enabled pilot contact" },
        403,
      );
    if (!connectionRow)
      return context.json({ error: "Connected sender required" }, 409);
    const configuration = binding.native ?? defaultNativeConfiguration;

    const requestPayload = JSON.stringify({ reply, consent });
    const prior = await db
      .prepare(
        `SELECT tenant_id,connection_id,contact_phone,state,outbound_message_id,reply_payload
         FROM whatsapp_native_outbox WHERE idempotency_key=?`,
      )
      .bind(idempotencyKey)
      .first<{
        tenant_id: number;
        connection_id: string;
        contact_phone: string;
        state: string;
        outbound_message_id: string | null;
        reply_payload: string;
      }>();
    if (prior) {
      if (
        prior.tenant_id !== agencyId ||
        prior.connection_id !== binding.connectionId ||
        prior.contact_phone !== to ||
        prior.reply_payload !== requestPayload
      )
        return context.json(
          { error: "Idempotency key belongs to another request" },
          409,
        );
      if (prior.state === "sent" && prior.outbound_message_id)
        return context.json(
          { data: { messageId: prior.outbound_message_id } },
          200,
        );
      return context.json(
        {
          error:
            "Previous send outcome is unavailable; do not resend automatically",
        },
        409,
      );
    }

    if (reply.kind === "template" && !consent)
      return context.json(
        { error: "Template follow-ups require confirmed recipient consent" },
        422,
      );
    try {
      buildNativeMessage(reply, configuration, to);
    } catch {
      return context.json(
        { error: "Native resource is invalid or unconfigured" },
        422,
      );
    }
    if (reply.kind !== "template") {
      const window = await readReplyWindow(db, binding.connectionId, to);
      if (!window.open)
        return context.json(
          { error: "Reply window is closed; use an approved template" },
          409,
        );
    }

    const reserved = await db
      .prepare(
        `INSERT INTO whatsapp_native_outbox
          (idempotency_key,tenant_id,connection_id,contact_phone,reply_payload,state,created_at)
         VALUES(?,?,?,?,?,'responding',?) ON CONFLICT(idempotency_key) DO NOTHING`,
      )
      .bind(
        idempotencyKey,
        agencyId,
        binding.connectionId,
        to,
        requestPayload,
        new Date().toISOString(),
      )
      .run();
    if (reserved.meta.changes !== 1)
      return context.json({ error: "Message is already being sent" }, 409);

    try {
      const messageId = await sendNativeMessage(
        nango,
        binding,
        reply,
        configuration,
        to,
        async () => {
          const current = await repository.resolve(
            connectionRow.phone_number_id,
            connectionRow.waba_id,
          );
          if (
            !current ||
            current.tenantId !== agencyId ||
            current.connectionId !== binding.connectionId ||
            current.employeeId !== binding.employeeId ||
            !current.allowedContacts.includes(to) ||
            JSON.stringify(current.native ?? defaultNativeConfiguration) !==
              JSON.stringify(configuration)
          )
            throw new Error("WHATSAPP_NATIVE_BINDING_CHANGED");
          if (reply.kind !== "template") {
            const window = await readReplyWindow(db, current.connectionId, to);
            if (!window.open) throw new Error("WHATSAPP_REPLY_WINDOW_CLOSED");
          }
        },
      );
      await db
        .prepare(
          `UPDATE whatsapp_native_outbox SET state='sent',outbound_message_id=?,completed_at=?
           WHERE idempotency_key=? AND state='responding'`,
        )
        .bind(messageId, new Date().toISOString(), idempotencyKey)
        .run();
      return context.json({ data: { messageId } }, 200);
    } catch (error) {
      await db
        .prepare(
          `UPDATE whatsapp_native_outbox SET state='failed',completed_at=?
           WHERE idempotency_key=? AND state='responding'`,
        )
        .bind(new Date().toISOString(), idempotencyKey)
        .run();
      if (isNativeResourceError(error))
        return context.json(
          { error: "Native resource is no longer approved" },
          422,
        );
      if (
        error instanceof Error &&
        [
          "WHATSAPP_NATIVE_BINDING_CHANGED",
          "WHATSAPP_REPLY_WINDOW_CLOSED",
        ].includes(error.message)
      )
        return context.json(
          { error: "Connection, configuration or reply window changed" },
          409,
        );
      return context.json(
        {
          error: "Send outcome is uncertain; inspect delivery before retrying",
        },
        502,
      );
    }
  });

  app.openAPIRegistry.registerPath(uploadRoute);
  app.post("/v1/whatsapp/native/media", async (context) => {
    const parsedTenant = tenantQuery.safeParse(context.req.query());
    if (!parsedTenant.success)
      return context.json({ error: "Invalid tenant" }, 400);
    const tenantId = parsedTenant.data.agencyId;
    if (!canManageWhatsappAssistant(actorFromContext(context), tenantId))
      return context.json({ error: "Tenant administrator required" }, 403);
    const settings = await repository.getSettings(tenantId);
    const connectionRow = settings
      ? await db
          .prepare(
            `SELECT phone_number_id,waba_id FROM tenant_whatsapp_connections
             WHERE id=? AND tenant_id=? AND status='connected' AND disconnected_at IS NULL`,
          )
          .bind(settings.connectionId, tenantId)
          .first<{ phone_number_id: string; waba_id: string }>()
      : undefined;
    const binding =
      connectionRow?.phone_number_id && connectionRow.waba_id
        ? await repository.resolve(
            connectionRow.phone_number_id,
            connectionRow.waba_id,
          )
        : undefined;
    if (!binding || binding.tenantId !== tenantId)
      return context.json({ error: "Connected assistant required" }, 409);

    const bounded = await readBoundedMultipartBody(context.req.raw);
    if (bounded.status === 413)
      return context.json({ error: "Media upload exceeds the limit" }, 413);
    if (!bounded.bytes)
      return context.json({ error: "Invalid multipart upload" }, 400);
    try {
      const parseRequest = new Request(context.req.raw.url, {
        method: "POST",
        headers: new Headers(context.req.raw.headers),
        body: bounded.bytes.slice().buffer as ArrayBuffer,
      });
      const form = await parseRequest.formData();
      const file = form.get("file");
      if (
        !(file instanceof File) ||
        file.size < 1 ||
        file.size > MAX_MEDIA_BYTES
      )
        return context.json({ error: "Invalid media file" }, 400);
      const mediaId = await uploadWhatsappMedia(
        nango,
        binding,
        new Uint8Array(await file.arrayBuffer()),
        file.type,
        file.name,
      );
      return context.json(
        { data: { mediaId, type: file.type, filename: file.name } },
        200,
      );
    } catch {
      return context.json({ error: "Media upload failed" }, 502);
    }
  });
}
