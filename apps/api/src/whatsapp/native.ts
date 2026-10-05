import { z } from "@hono/zod-openapi";
import type { WhatsappNangoClient } from "./contracts";
import type { WhatsappAssistantBinding } from "./inbound-contracts";

const keySchema = z.string().trim().min(1).max(120);
const labelSchema = z.string().trim().min(1).max(120);
const graphIdSchema = z.string().regex(/^\d{5,32}$/);
const resourceBase = {
  key: keySchema,
  label: labelSchema,
};

const flowResourceSchema = z
  .object({
    ...resourceBase,
    flowId: graphIdSchema,
    screen: keySchema,
  })
  .strict();

const catalogResourceSchema = z
  .object({
    ...resourceBase,
    catalogId: graphIdSchema,
    products: z
      .array(z.object({ id: keySchema, label: labelSchema }).strict())
      .max(100),
  })
  .strict();

const templateResourceSchema = z
  .object({
    ...resourceBase,
    name: keySchema,
    language: z.string().trim().min(2).max(35),
    parameterCount: z.number().int().min(0).max(20),
  })
  .strict();

const mediaResourceSchema = z
  .object({
    ...resourceBase,
    type: z.enum(["image", "audio", "video", "document"]),
    mediaId: graphIdSchema,
    filename: z.string().trim().min(1).max(255).optional(),
  })
  .strict();

const locationResourceSchema = z
  .object({
    ...resourceBase,
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    name: z.string().trim().min(1).max(256).optional(),
    address: z.string().trim().min(1).max(512).optional(),
  })
  .strict();

export const nativeConfigurationSchema = z
  .object({
    replyButtons: z.boolean().default(false),
    listMessages: z.boolean().default(false),
    mediaUnderstanding: z.boolean().default(false),
    readReceipts: z.boolean().default(false),
    typingIndicator: z.boolean().default(false),
    flows: z.array(flowResourceSchema).max(20).default([]),
    catalogs: z.array(catalogResourceSchema).max(20).default([]),
    templates: z.array(templateResourceSchema).max(20).default([]),
    media: z.array(mediaResourceSchema).max(20).default([]),
    locations: z.array(locationResourceSchema).max(20).default([]),
  })
  .strict()
  .superRefine((configuration, context) => {
    if (configuration.typingIndicator && !configuration.readReceipts)
      context.addIssue({
        code: "custom",
        message: "Typing indicators require read receipts",
        path: ["typingIndicator"],
      });
    const seen = new Set<string>();
    for (const resource of [
      ...configuration.flows,
      ...configuration.catalogs,
      ...configuration.templates,
      ...configuration.media,
      ...configuration.locations,
    ]) {
      if (seen.has(resource.key))
        context.addIssue({
          code: "custom",
          message: "Native resource keys must be unique",
          path: ["resources", resource.key],
        });
      seen.add(resource.key);
    }
  });

export type NativeConfiguration = z.infer<typeof nativeConfigurationSchema>;

export const defaultNativeConfiguration: NativeConfiguration =
  nativeConfigurationSchema.parse({});

const buttonOptionSchema = z
  .object({ id: keySchema, title: z.string().trim().min(1).max(20) })
  .strict();
const listOptionSchema = z
  .object({
    id: keySchema,
    title: z.string().trim().min(1).max(24),
    description: z.string().trim().min(1).max(72).optional(),
  })
  .strict();
const distinctOptionIds = <T extends { id: string }>(items: T[]) =>
  new Set(items.map(({ id }) => id)).size === items.length;

export const nativeReplySchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("text"),
      text: z.string().trim().min(1).max(4096),
    })
    .strict(),
  z
    .object({
      kind: z.literal("buttons"),
      text: z.string().trim().min(1).max(1024),
      options: z.array(buttonOptionSchema).min(1).max(3),
    })
    .strict()
    .refine(
      (reply) => distinctOptionIds(reply.options),
      "Reply option IDs must be unique",
    ),
  z
    .object({
      kind: z.literal("list"),
      text: z.string().trim().min(1).max(1024),
      buttonLabel: z.string().trim().min(1).max(20),
      options: z.array(listOptionSchema).min(1).max(10),
    })
    .strict()
    .refine(
      (reply) => distinctOptionIds(reply.options),
      "Reply option IDs must be unique",
    ),
  z
    .object({
      kind: z.literal("flow"),
      text: z.string().trim().min(1).max(1024),
      resourceKey: keySchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("catalog"),
      text: z.string().trim().min(1).max(1024),
      resourceKey: keySchema,
      productIds: z.array(keySchema).min(1).max(30),
    })
    .strict()
    .refine(
      (reply) => distinctOptionIds(reply.productIds.map((id) => ({ id }))),
      "Product IDs must be unique",
    ),
  z
    .object({
      kind: z.literal("media"),
      resourceKey: keySchema,
      caption: z.string().trim().min(1).max(1024).optional(),
    })
    .strict(),
  z.object({ kind: z.literal("location"), resourceKey: keySchema }).strict(),
  z
    .object({
      kind: z.literal("template"),
      resourceKey: keySchema,
      parameters: z.array(z.string().max(1024)).max(20),
    })
    .strict(),
]);

export type NativeReply = z.infer<typeof nativeReplySchema>;

function resourceByKey<T extends { key: string }>(
  resources: T[],
  key: string,
): T {
  const resource = resources.find((candidate) => candidate.key === key);
  if (!resource) throw new Error("WhatsApp native resource is not configured");
  return resource;
}

function recipientPhone(value: string): string {
  const normalized = value.trim().replace(/\s/g, "").replace(/^\+/, "");
  if (!/^[1-9]\d{6,14}$/.test(normalized))
    throw new Error("WhatsApp recipient is invalid");
  return normalized;
}

function senderPhoneNumberId(binding: WhatsappAssistantBinding): string {
  const id = binding.connection.phoneNumberId;
  if (!id || !/^\d{5,20}$/.test(id))
    throw new Error("WHATSAPP_SENDER_UNAVAILABLE");
  return id;
}

function wabaId(binding: WhatsappAssistantBinding): string {
  const id = binding.connection.wabaId;
  if (!id || !/^\d{5,32}$/.test(id))
    throw new Error("WHATSAPP_NATIVE_RESOURCE_UNAVAILABLE");
  return id;
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

function bodyParameterCount(value: unknown): number | undefined {
  const components = Array.isArray(value) ? value : [];
  if (
    components.some(
      (component) =>
        !component ||
        typeof component !== "object" ||
        !["BODY", "FOOTER"].includes(
          String((component as Record<string, unknown>).type),
        ),
    )
  )
    return undefined;
  const bodies = components.filter(
    (component) => (component as Record<string, unknown>).type === "BODY",
  ) as Record<string, unknown>[];
  if (bodies.length !== 1 || typeof bodies[0].text !== "string")
    return undefined;
  const footers = components.filter(
    (component) => (component as Record<string, unknown>).type === "FOOTER",
  ) as Record<string, unknown>[];
  if (
    footers.length > 1 ||
    footers.some(
      (footer) =>
        typeof footer.text !== "string" || /\{\{[^{}]+\}\}/.test(footer.text),
    )
  )
    return undefined;
  const placeholders = bodies[0].text.match(/\{\{[^{}]+\}\}/g) ?? [];
  const positional = bodies[0].text.match(/\{\{\d+\}\}/g) ?? [];
  if (placeholders.length !== positional.length) return undefined;
  const indexes = [...bodies[0].text.matchAll(/\{\{(\d+)\}\}/g)].map((match) =>
    Number(match[1]),
  );
  if (new Set(indexes).size !== indexes.length) return undefined;
  const sorted = [...indexes].sort((left, right) => left - right);
  if (sorted.some((value, index) => value !== index + 1)) return undefined;
  return sorted.length;
}

async function validateProviderResource(
  nango: Pick<WhatsappNangoClient, "proxy">,
  binding: WhatsappAssistantBinding,
  reply: NativeReply,
  configuration: NativeConfiguration,
): Promise<void> {
  if (reply.kind === "flow") {
    const flow = resourceByKey(configuration.flows, reply.resourceKey);
    const response = await nango.proxy({
      connection: binding.connection,
      method: "GET",
      path: `/v21.0/${wabaId(binding)}/flows?fields=id,status,endpoint_uri&limit=100`,
    });
    if (!response.ok) throw new Error("WHATSAPP_NATIVE_RESOURCE_UNAVAILABLE");
    const flows = providerRows(await response.json().catch(() => undefined));
    if (
      !flows.some(
        (candidate) =>
          candidate.id === flow.flowId &&
          candidate.status === "PUBLISHED" &&
          (candidate.endpoint_uri === undefined ||
            candidate.endpoint_uri === null ||
            candidate.endpoint_uri === ""),
      )
    )
      throw new Error("WHATSAPP_NATIVE_RESOURCE_UNAVAILABLE");
  } else if (reply.kind === "template") {
    const template = resourceByKey(configuration.templates, reply.resourceKey);
    const response = await nango.proxy({
      connection: binding.connection,
      method: "GET",
      path: `/v21.0/${wabaId(binding)}/message_templates?fields=name,language,status,components&name=${encodeURIComponent(template.name)}`,
    });
    if (!response.ok) throw new Error("WHATSAPP_NATIVE_RESOURCE_UNAVAILABLE");
    const templates = providerRows(
      await response.json().catch(() => undefined),
    );
    const approved = templates.some((candidate) => {
      if (
        candidate.name !== template.name ||
        candidate.language !== template.language ||
        candidate.status !== "APPROVED"
      )
        return false;
      return (
        bodyParameterCount(candidate.components) === template.parameterCount
      );
    });
    if (!approved) throw new Error("WHATSAPP_NATIVE_RESOURCE_UNAVAILABLE");
  }
}

export function buildNativeMessage(
  input: NativeReply,
  inputConfiguration: NativeConfiguration,
  to: string,
): Record<string, unknown> {
  const reply = nativeReplySchema.parse(input);
  const configuration = nativeConfigurationSchema.parse(inputConfiguration);
  const base = {
    messaging_product: "whatsapp",
    to: recipientPhone(to),
  };
  switch (reply.kind) {
    case "text":
      return { ...base, type: "text", text: { body: reply.text } };
    case "buttons":
      if (!configuration.replyButtons)
        throw new Error("WhatsApp reply buttons are disabled");
      return {
        ...base,
        type: "interactive",
        interactive: {
          type: "button",
          body: { text: reply.text },
          action: {
            buttons: reply.options.map(({ id, title }) => ({
              type: "reply",
              reply: { id, title },
            })),
          },
        },
      };
    case "list":
      if (!configuration.listMessages)
        throw new Error("WhatsApp list messages are disabled");
      return {
        ...base,
        type: "interactive",
        interactive: {
          type: "list",
          body: { text: reply.text },
          action: {
            button: reply.buttonLabel,
            sections: [
              {
                title: "Options",
                rows: reply.options.map(({ id, title, description }) => ({
                  id,
                  title,
                  ...(description ? { description } : {}),
                })),
              },
            ],
          },
        },
      };
    case "flow": {
      const flow = resourceByKey(configuration.flows, reply.resourceKey);
      return {
        ...base,
        type: "interactive",
        interactive: {
          type: "flow",
          body: { text: reply.text },
          action: {
            name: "flow",
            parameters: {
              flow_message_version: "3",
              flow_token: crypto.randomUUID(),
              flow_id: String(flow.flowId),
              flow_cta: "Open",
              flow_action: "navigate",
              flow_action_payload: { screen: flow.screen },
            },
          },
        },
      };
    }
    case "catalog": {
      const catalog = resourceByKey(configuration.catalogs, reply.resourceKey);
      const productIds = new Set(catalog.products.map(({ id }) => id));
      if (reply.productIds.some((id) => !productIds.has(id)))
        throw new Error("WhatsApp catalog product is not configured");
      return {
        ...base,
        type: "interactive",
        interactive: {
          type: "product_list",
          header: { type: "text", text: catalog.label.slice(0, 60) },
          body: { text: reply.text },
          action: {
            catalog_id: String(catalog.catalogId),
            sections: [
              {
                title: catalog.label.slice(0, 24),
                product_items: reply.productIds.map((product_retailer_id) => ({
                  product_retailer_id,
                })),
              },
            ],
          },
        },
      };
    }
    case "media": {
      const media = resourceByKey(configuration.media, reply.resourceKey);
      const content: Record<string, unknown> = { id: String(media.mediaId) };
      if (reply.caption && media.type !== "audio")
        content.caption = reply.caption;
      if (media.type === "document" && media.filename)
        content.filename = media.filename;
      return { ...base, type: media.type, [media.type]: content };
    }
    case "location": {
      const location = resourceByKey(
        configuration.locations,
        reply.resourceKey,
      );
      return {
        ...base,
        type: "location",
        location: {
          latitude: location.latitude,
          longitude: location.longitude,
          ...(location.name ? { name: location.name } : {}),
          ...(location.address ? { address: location.address } : {}),
        },
      };
    }
    case "template": {
      const template = resourceByKey(
        configuration.templates,
        reply.resourceKey,
      );
      if (reply.parameters.length !== template.parameterCount)
        throw new Error("WhatsApp template parameter count does not match");
      return {
        ...base,
        type: "template",
        template: {
          name: template.name,
          language: { code: template.language },
          ...(reply.parameters.length
            ? {
                components: [
                  {
                    type: "body",
                    parameters: reply.parameters.map((text) => ({
                      type: "text",
                      text,
                    })),
                  },
                ],
              }
            : {}),
        },
      };
    }
  }
}

export function nativeReplyText(
  input: NativeReply | string,
  inputConfiguration?: NativeConfiguration,
): string {
  if (typeof input === "string") return input;
  const reply = nativeReplySchema.parse(input);
  let configuration: NativeConfiguration | undefined;
  if (inputConfiguration !== undefined) {
    configuration = nativeConfigurationSchema.parse(inputConfiguration);
  }
  const label = (resources: { key: string; label: string }[], key: string) =>
    resources.find((resource) => resource.key === key)?.label ?? key;
  switch (reply.kind) {
    case "text":
      return reply.text;
    case "buttons":
    case "list":
      return `${reply.text} [${reply.options.map(({ title }) => title).join(" / ")}]`;
    case "flow":
      return `${reply.text} [${label(configuration?.flows ?? [], reply.resourceKey)}]`;
    case "catalog": {
      const catalog = configuration?.catalogs.find(
        (resource) => resource.key === reply.resourceKey,
      );
      const products = reply.productIds.map(
        (id) =>
          catalog?.products.find((product) => product.id === id)?.label ?? id,
      );
      return `${reply.text} [${label(configuration?.catalogs ?? [], reply.resourceKey)}: ${products.join(", ")}]`;
    }
    case "media": {
      const mediaLabel = label(configuration?.media ?? [], reply.resourceKey);
      return reply.caption ? `${mediaLabel}: ${reply.caption}` : mediaLabel;
    }
    case "location":
      return label(configuration?.locations ?? [], reply.resourceKey);
    case "template":
      return label(configuration?.templates ?? [], reply.resourceKey);
  }
}

export async function sendNativeMessage(
  nango: Pick<WhatsappNangoClient, "proxy">,
  binding: WhatsappAssistantBinding,
  reply: NativeReply,
  configuration: NativeConfiguration,
  to: string,
  beforeSend?: () => Promise<void> | void,
): Promise<string> {
  const phoneNumberId = senderPhoneNumberId(binding);
  const body = buildNativeMessage(reply, configuration, to);
  const parsedReply = nativeReplySchema.parse(reply);
  const parsedConfiguration = nativeConfigurationSchema.parse(configuration);
  await validateProviderResource(
    nango,
    binding,
    parsedReply,
    parsedConfiguration,
  );
  await beforeSend?.();
  const response = await nango.proxy({
    connection: binding.connection,
    method: "POST",
    path: `/v21.0/${phoneNumberId}/messages`,
    body,
  });
  if (!response.ok) throw new Error("WHATSAPP_SEND_FAILED");
  const payload = (await response.json().catch(() => undefined)) as
    { messages?: Array<{ id?: unknown }> } | undefined;
  const messageId = payload?.messages?.[0]?.id;
  if (typeof messageId !== "string" || !messageId)
    throw new Error("WHATSAPP_SEND_UNCERTAIN");
  return messageId;
}

export async function sendReadIndicator(
  nango: Pick<WhatsappNangoClient, "proxy">,
  binding: WhatsappAssistantBinding,
  messageId: string,
  typing: boolean,
): Promise<void> {
  if (!messageId.trim() || messageId.length > 200)
    throw new Error("WhatsApp message ID is invalid");
  const phoneNumberId = senderPhoneNumberId(binding);
  const response = await nango.proxy({
    connection: binding.connection,
    method: "POST",
    path: `/v21.0/${phoneNumberId}/messages`,
    body: {
      messaging_product: "whatsapp",
      status: "read",
      message_id: messageId,
      ...(typing ? { typing_indicator: { type: "text" } } : {}),
    },
  });
  if (!response.ok) throw new Error("WHATSAPP_READ_INDICATOR_FAILED");
}
