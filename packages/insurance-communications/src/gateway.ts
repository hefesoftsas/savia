import { z } from "zod";
import type { ExtensionActionContext } from "@savia/studio-shared/extension-runtime";
export type GatewayOptions = {
  allowedOrigins?: readonly string[];
  fetcher?: typeof fetch;
  payloadSchemas?: Record<string, z.ZodType<Record<string, unknown>>>;
};
export const receiptSchema = z
  .object({
    reference: z.string().min(1).max(200),
    state: z.enum(["accepted", "delivered", "failed", "pending"]),
    documentUrl: z.string().url().optional(),
    signedAt: z.string().datetime({ offset: true }).optional(),
    evidenceUrl: z.string().url().optional(),
  })
  .strip();
export type Receipt = z.infer<typeof receiptSchema>;
const inputSchema = z
  .object({
    operationKey: z.string().min(8).max(200),
    payload: z.record(z.string(), z.unknown()),
  })
  .strict();
const nonempty = z.string().trim().min(1).max(200);
const instant = z.string().datetime({ offset: true });
export function payloadSchemas(
  extensionId: string,
): Record<string, z.ZodType<Record<string, unknown>>> {
  if (["insurance.communications", "insurance.campaigns"].includes(extensionId))
    return {
      send: z
        .object({
          recipient: z.string().email().max(320),
          body: z.string().trim().min(1).max(10000),
          consent: z.literal(true),
          suppressed: z.literal(false),
        })
        .passthrough(),
      status: z
        .object({ operationKey: z.string().min(8).max(200) })
        .passthrough(),
    };
  if (extensionId === "insurance.calendar")
    return {
      sync: z
        .object({
          id: nonempty,
          title: z.string().trim().min(1).max(500),
          start: instant,
          end: instant,
          description: z.string().max(10000).optional(),
          timeZone: nonempty.refine((value) => {
            try {
              new Intl.DateTimeFormat("en", { timeZone: value });
              return true;
            } catch {
              return false;
            }
          }),
        })
        .passthrough()
        .refine(
          (event) => Date.parse(event.end) > Date.parse(event.start),
          "End must follow start",
        ),
    };
  if (extensionId === "insurance.carriers") {
    const request = z
      .object({ policy: nonempty, carrier: nonempty })
      .passthrough();
    return {
      "policy-status": request,
      documents: request,
      "request-issuance": request,
    };
  }
  if (extensionId === "insurance.document-generation")
    return {
      "request-signature": z
        .object({
          documentId: nonempty,
          fileId: nonempty,
          recipient: z.string().email().max(320),
          operationKey: z.string().min(8).max(200),
        })
        .passthrough(),
      "signature-status": z
        .object({
          documentId: nonempty,
          fileId: nonempty,
          operationKey: z.string().min(8).max(200),
        })
        .passthrough(),
    };
  return {};
}
function actionInput(
  extensionId: string,
  actionId: string,
  schemas = payloadSchemas(extensionId),
) {
  const payload = schemas[actionId];
  return payload ? inputSchema.extend({ payload }) : inputSchema;
}
export function runtime(
  extensionId: string,
  actions: string[],
  schemas = payloadSchemas(extensionId),
) {
  return {
    connectors: [
      {
        extensionId,
        connectorId: `${extensionId}.gateway`,
        label: "Conexión de integración",
        configurationSchema: z
          .object({ endpoint: z.string().url(), token: z.string().min(1) })
          .strict(),
        secretFields: ["token"],
      },
    ],
    actions: actions.map((actionId) => ({
      extensionId,
      actionId,
      connectorId: `${extensionId}.gateway`,
      inputSchema: actionInput(extensionId, actionId, schemas),
    })),
  };
}
export function createGatewayActions(
  extensionId: string,
  actions: string[],
  options: GatewayOptions = {},
) {
  return actions.map((actionId) => ({
    extensionId,
    actionId,
    async execute(args: {
      context: ExtensionActionContext;
      connection: Record<string, unknown>;
      input: Record<string, unknown>;
    }) {
      if (
        args.context.extensionId !== extensionId ||
        args.context.actionId !== actionId
      )
        throw new Error("Contexto de operación no válido.");
      const input = inputSchema.parse(args.input);
      let endpoint: URL;
      try {
        endpoint = new URL(String(args.connection.endpoint));
      } catch {
        throw new Error("Conexión no configurada.");
      }
      if (
        endpoint.protocol !== "https:" ||
        endpoint.username ||
        endpoint.password ||
        endpoint.search ||
        endpoint.hash ||
        !options.allowedOrigins?.includes(endpoint.origin) ||
        /(^localhost$|\.localhost$|\.local$|^[\d.]+$|:)/i.test(
          endpoint.hostname,
        )
      )
        throw new Error("Destino de integración no autorizado.");
      if (typeof args.connection.token !== "string" || !args.connection.token)
        throw new Error("Conexión no configurada.");
      if (
        actionId === "send" &&
        (input.payload.consent !== true || input.payload.suppressed !== false)
      )
        throw new Error(
          "Se requiere consentimiento vigente y ausencia de supresión.",
        );
      const validated = actionInput(
        extensionId,
        actionId,
        options.payloadSchemas,
      ).safeParse(input);
      if (!validated.success)
        throw new Error(
          "Datos de operación no válidos. Revisa los campos requeridos.",
        );
      input.payload = validated.data.payload;
      let response: Response;
      try {
        response = await (options.fetcher ?? fetch)(endpoint.toString(), {
          method: "POST",
          redirect: "error",
          signal: AbortSignal.timeout(20000),
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${args.connection.token}`,
            "Idempotency-Key": `${args.context.tenantId}:${extensionId}:${actionId}:${input.operationKey}`,
          },
          body: JSON.stringify({
            version: 1,
            extensionId,
            actionId,
            tenantId: args.context.tenantId,
            principalId: args.context.principalId,
            payload: input.payload,
          }),
        });
      } catch {
        throw new Error(
          "Resultado desconocido. Consulta el estado antes de reintentar con la misma referencia.",
        );
      }
      if (!response.ok)
        throw new Error(
          "El proveedor rechazó la solicitud. Consulta el historial antes de reintentar.",
        );
      let receipt: Receipt;
      try {
        const reader = response.body?.getReader();
        if (!reader) throw Error("Empty response");
        let size = 0;
        const chunks: Uint8Array[] = [];
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 65536) {
            await reader.cancel();
            throw Error("Oversized response");
          }
          chunks.push(value);
        }
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.byteLength;
        }
        receipt = receiptSchema.parse(
          JSON.parse(new TextDecoder().decode(bytes)),
        );
      } catch {
        throw new Error(
          "Respuesta inválida; resultado desconocido. Consulta al proveedor con la misma referencia.",
        );
      }
      for (const link of [receipt.documentUrl, receipt.evidenceUrl]) {
        if (!link) continue;
        const url = new URL(link);
        if (url.protocol !== "https:" || url.username || url.password)
          throw new Error("El proveedor devolvió un documento no seguro.");
      }
      // Never forward arbitrary provider fields or reflected credentials into persisted action output.
      if (JSON.stringify(receipt).includes(args.connection.token))
        throw new Error("Respuesta inválida del proveedor.");
      return receipt;
    },
  }));
}
