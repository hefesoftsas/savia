import { z } from "@hono/zod-openapi";

const bounded = z.string().min(1).max(255);
export const nativeInboundSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("choice"),
      choiceType: z.enum(["button", "list", "template"]),
      id: bounded,
      title: z.string().min(1).max(255),
      contextMessageId: bounded.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("flow"),
      values: z.record(z.string(), z.unknown()),
    })
    .strict(),
  z
    .object({
      kind: z.literal("location"),
      latitude: z.number().min(-90).max(90),
      longitude: z.number().min(-180).max(180),
      name: z.string().max(255).optional(),
      address: z.string().max(1024).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("media"),
      mediaType: z.enum(["image", "audio", "video", "document"]),
      mediaId: z.string().regex(/^\d{5,32}$/),
      mimeType: z.string().max(128),
      sha256: z.string().max(128).optional(),
      filename: z.string().max(255).optional(),
      caption: z.string().max(1024).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("order"),
      catalogId: bounded,
      items: z
        .array(
          z
            .object({
              productId: bounded,
              quantity: z.number().int().positive().max(10000),
              price: z.string().max(32),
              currency: z.string().max(8),
            })
            .strict(),
        )
        .min(1)
        .max(30),
    })
    .strict(),
]);
export type NativeInbound = z.infer<typeof nativeInboundSchema>;

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid native WhatsApp message");
  return value as Record<string, unknown>;
}

/** Provider payloads are conversational input, never action authorization. */
export function parseWhatsappNativeInput(
  value: unknown,
): { text: string; native?: NativeInbound } | undefined {
  const message = record(value);
  if (message.type === "text") {
    const text = record(message.text).body;
    if (typeof text !== "string") throw new Error("Invalid WhatsApp text");
    return { text };
  }
  if (message.type === "interactive" || message.type === "button") {
    const interactive =
      message.type === "button"
        ? { type: "template", ...record(message.button) }
        : record(message.interactive);
    if (
      ["button_reply", "list_reply", "template"].includes(
        String(interactive.type),
      )
    ) {
      const choice =
        interactive.type === "template"
          ? interactive
          : record(interactive[String(interactive.type)]);
      const context = message.context ? record(message.context) : undefined;
      const native = nativeInboundSchema.parse({
        kind: "choice",
        choiceType:
          interactive.type === "button_reply"
            ? "button"
            : interactive.type === "list_reply"
              ? "list"
              : "template",
        id: choice.id ?? choice.payload,
        title: choice.title ?? choice.text,
        ...(typeof context?.id === "string"
          ? { contextMessageId: context.id }
          : {}),
      });
      return { text: native.kind === "choice" ? native.title : "", native };
    }
    if (interactive.type === "nfm_reply") {
      const response = record(interactive.nfm_reply).response_json;
      if (typeof response !== "string" || response.length > 16384)
        throw new Error("Invalid WhatsApp Flow response");
      const parsed = record(JSON.parse(response));
      const values = Object.fromEntries(
        Object.entries(parsed).filter(
          ([key]) =>
            !["flow_token", "__proto__", "constructor", "prototype"].includes(
              key,
            ),
        ),
      );
      const native = nativeInboundSchema.parse({ kind: "flow", values });
      return {
        text: `Form response: ${JSON.stringify(values)}`.slice(0, 4096),
        native,
      };
    }
    return undefined;
  }
  if (message.type === "location") {
    const location = record(message.location);
    const native = nativeInboundSchema.parse({
      kind: "location",
      latitude: location.latitude,
      longitude: location.longitude,
      ...(typeof location.name === "string" ? { name: location.name } : {}),
      ...(typeof location.address === "string"
        ? { address: location.address }
        : {}),
    });
    return {
      text: `Shared location: ${JSON.stringify(location)}`.slice(0, 4096),
      native,
    };
  }
  if (["image", "audio", "video", "document"].includes(String(message.type))) {
    const media = record(message[String(message.type)]);
    const native = nativeInboundSchema.parse({
      kind: "media",
      mediaType: message.type,
      mediaId: media.id,
      mimeType: media.mime_type,
      ...(typeof media.sha256 === "string" ? { sha256: media.sha256 } : {}),
      ...(typeof media.filename === "string"
        ? { filename: media.filename }
        : {}),
      ...(typeof media.caption === "string" ? { caption: media.caption } : {}),
    });
    return {
      text:
        typeof media.caption === "string" && media.caption.trim()
          ? media.caption
          : `Contact sent a ${message.type} attachment.`,
      native,
    };
  }
  if (message.type === "order") {
    const order = record(message.order);
    if (!Array.isArray(order.product_items))
      throw new Error("Invalid catalog order");
    const native = nativeInboundSchema.parse({
      kind: "order",
      catalogId: order.catalog_id,
      items: order.product_items.map((item) => {
        const product = record(item);
        return {
          productId: product.product_retailer_id,
          quantity: product.quantity,
          price: String(product.item_price),
          currency: product.currency,
        };
      }),
    });
    return {
      text: `Catalog order request: ${JSON.stringify(native)}`.slice(0, 4096),
      native,
    };
  }
  return undefined;
}
