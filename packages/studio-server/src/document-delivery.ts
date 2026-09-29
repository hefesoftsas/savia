import type { Context, Hono } from "hono";
import { z } from "zod";
import type { Env } from "./context";
import { fail } from "./context";
import { getObject, getRecord, audit } from "./services";
import {
  policyFor,
  requireRecordAccess,
  accessRecord,
  accessDenied,
} from "./access-authorization";
import { decideRecord } from "@savia/studio-shared/access-evaluator";

export type DocumentProvider =
  "outlook" | "onedrive_personal" | "onedrive_business";
export type DocumentDeliveryConnection = {
  id: string;
  provider: DocumentProvider;
  status: string;
  externalAccountLabel: string | null;
};
/** Callbacks are bound to the authenticated principal by the host API. */
export type DocumentDeliveryBridge = {
  actorName?: string;
  connections(): Promise<DocumentDeliveryConnection[]>;
  folders(
    provider: Exclude<DocumentProvider, "outlook">,
    parentId?: string,
  ): Promise<{ id: string; name: string }[]>;
  saveCopy(input: {
    provider: Exclude<DocumentProvider, "outlook">;
    connectionKey: string;
    folderId?: string;
    name: string;
    mimeType: string;
    content: Uint8Array<ArrayBuffer>;
  }): Promise<{ id: string; name: string; webUrl: string | null }>;
  sendEmail(input: {
    connectionKey: string;
    to: string[];
    subject: string;
    body: string;
    file: { name: string; mimeType: string; content: Uint8Array<ArrayBuffer> };
  }): Promise<void>;
  seal(id: string, payload: Record<string, unknown>): Promise<string>;
  unseal(id: string, token: string): Promise<Record<string, unknown>>;
};
const provider = z.enum(["onedrive_personal", "onedrive_business"]);
const identifier = z
  .string()
  .min(1)
  .max(256)
  .refine(
    (v) =>
      Boolean(v.trim()) &&
      !/[\\/\u0000-\u001f\u007f]/.test(v) &&
      ![".", ".."].includes(v),
    "Invalid folder identifier",
  );
const name = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .refine(
    (v) => !/[\\/\u0000-\u001f<>:"|?*]/.test(v) && ![".", ".."].includes(v),
    "Invalid file name",
  );
export const documentDeliveryRequestSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("onedrive"),
    connectionKey: z.string().min(1).max(300),
    version: z.number().int().positive(),
    provider,
    folderId: identifier.optional(),
    name,
  }),
  z.object({
    action: z.literal("outlook"),
    connectionKey: z.string().min(1).max(300),
    version: z.number().int().positive(),
    to: z.array(z.string().trim().email()).min(1).max(20),
    subject: z.string().trim().min(1).max(2000),
    body: z.string().trim().min(1).max(10000),
  }),
]);
export const documentDeliveryConfirmationSchema = z.object({
  confirmationId: z.uuid(),
  token: z.string().min(1).max(50000),
});
type FileRow = {
  id: string;
  name: string;
  mime: string;
  size: number;
  version: number;
  object_name: string;
  record_id: string;
  field_name: string;
  storage_key: string;
};
type History = {
  id: string;
  action: "onedrive" | "outlook";
  provider: DocumentProvider;
  version: number;
  status: "succeeded" | "unknown";
  createdAt: string;
  actorId: string;
  actorName?: string;
};
async function fileContext(c: Context<Env>) {
  const db = c.env.DB,
    tenant = c.get("tenant");
  const file = await db
    .prepare("SELECT * FROM studio_files WHERE tenant_id=? AND id=?")
    .bind(tenant, c.req.param("id"))
    .first<FileRow>();
  if (!file) return fail("El adjunto no existe.", 404);
  await getObject(db, tenant, file.object_name);
  const record = await getRecord(db, tenant, file.object_name, file.record_id);
  requireRecordAccess(db, file.object_name, "export", record);
  const policy = policyFor(db);
  if (policy && file.field_name) {
    for (const action of ["read", "export"] as const)
      if (
        !decideRecord(
          policy,
          `collection:${file.object_name}`,
          action,
          accessRecord(record),
        ).fields.includes(file.field_name)
      )
        accessDenied();
  }
  return { db, tenant, file };
}
function ready(bridge?: DocumentDeliveryBridge) {
  if (!bridge)
    return fail(
      "Las integraciones de documentos no están disponibles. Configura Outlook o OneDrive en Conexiones.",
      422,
    );
  return bridge;
}
async function connected(
  bridge: DocumentDeliveryBridge,
  provider: DocumentProvider,
  expectedId?: string,
) {
  const connection = (await bridge.connections()).find(
    (c) => c.provider === provider && c.status === "connected",
  );
  if (!connection || (expectedId && connection.id !== expectedId))
    return fail(
      "La conexión cambió o necesita reconectarse. Revisa Conexiones y prepara de nuevo la acción.",
      409,
    );
  return connection;
}
function limit(action: string) {
  return action === "outlook" ? 2 * 1024 * 1024 : 5 * 1024 * 1024;
}
function sameVersion(file: FileRow, version: number) {
  if (file.version !== version)
    fail(
      "El documento cambió. Actualiza y revisa la nueva versión antes de continuar.",
      409,
    );
}
export function registerDocumentDelivery(
  app: Hono<Env>,
  supplied?: DocumentDeliveryBridge,
) {
  app.use("/api/file/:id/delivery*", async (c, next) => {
    c.header("cache-control", "no-store");
    await next();
  });
  app.get("/api/file/:id/delivery", async (c) => {
    const { db, tenant, file } = await fileContext(c);
    // Use a literal indexed prefix range: D1 limits LIKE patterns to 50 bytes,
    // shorter than the delivery prefix plus a UUID file ID.
    const historyPrefix = `document-delivery:${file.id}`;
    const rows = await db
      .prepare(
        "SELECT response FROM studio_requests WHERE tenant_id=? AND request_key >= ? AND request_key < ? ORDER BY request_key DESC LIMIT 50",
      )
      .bind(tenant, `${historyPrefix}:`, `${historyPrefix};`)
      .all<{ response: string }>();
    const history = rows.results
      .map((row) => JSON.parse(row.response) as History)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return c.json({
      data: {
        file: {
          id: file.id,
          name: file.name,
          mime: file.mime,
          size: file.size,
          version: file.version,
        },
        connections: supplied
          ? (await supplied.connections()).map(
              ({ id, ...publicConnection }) => ({
                ...publicConnection,
                key: id,
              }),
            )
          : [],
        history,
      },
    });
  });
  app.get("/api/file/:id/delivery/folders", async (c) => {
    await fileContext(c);
    const parsed = z
      .object({ provider, parentId: identifier.optional() })
      .parse(c.req.query());
    const bridge = ready(supplied);
    await connected(bridge, parsed.provider);
    try {
      return c.json({
        data: await bridge.folders(parsed.provider, parsed.parentId),
      });
    } catch {
      return fail(
        "No se pudieron cargar las carpetas de OneDrive. Comprueba la conexión.",
        502,
      );
    }
  });
  app.post("/api/file/:id/delivery/prepare", async (c) => {
    const { tenant, file } = await fileContext(c),
      bridge = ready(supplied);
    const input = documentDeliveryRequestSchema.parse(await c.req.json());
    sameVersion(file, input.version);
    if (file.size > limit(input.action))
      return fail(
        input.action === "outlook"
          ? "Outlook admite adjuntos de hasta 2 MB en este flujo."
          : "La copia en OneDrive admite hasta 5 MB.",
        413,
      );
    const connection = await connected(
      bridge,
      input.action === "outlook" ? "outlook" : input.provider,
      input.connectionKey,
    );
    const confirmationId = crypto.randomUUID(),
      expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    const token = await bridge.seal(confirmationId, {
      ...input,
      tenant,
      fileId: file.id,
      principalId: c.get("principalId"),
      connectionId: connection.id,
      expiresAt,
    });
    return c.json({ data: { confirmationId, token, expiresAt } });
  });
  app.post("/api/file/:id/delivery/confirm", async (c) => {
    const { db, tenant, file } = await fileContext(c),
      bridge = ready(supplied);
    const confirmation = documentDeliveryConfirmationSchema.parse(
      await c.req.json(),
    );
    let payload: Record<string, unknown>;
    try {
      payload = await bridge.unseal(
        confirmation.confirmationId,
        confirmation.token,
      );
    } catch {
      return fail(
        "La confirmación no es válida. Revisa la acción de nuevo.",
        409,
      );
    }
    if (
      payload.tenant !== tenant ||
      payload.fileId !== file.id ||
      payload.principalId !== c.get("principalId") ||
      typeof payload.expiresAt !== "string" ||
      !Number.isFinite(Date.parse(payload.expiresAt)) ||
      Date.parse(payload.expiresAt) <= Date.now()
    )
      return fail(
        "La confirmación expiró o pertenece a otra sesión. Revisa la acción de nuevo.",
        409,
      );
    const input = documentDeliveryRequestSchema.parse(payload);
    sameVersion(file, input.version);
    const destination = input.action === "outlook" ? "outlook" : input.provider;
    await connected(bridge, destination, String(payload.connectionId));
    if (file.size > limit(input.action))
      return fail("El archivo supera el límite de esta acción.", 413);
    const object = await c.env.FILES.get(file.storage_key);
    if (!object) return fail("No se encontró el contenido del documento.", 404);
    if (object.size > limit(input.action))
      return fail("El archivo supera el límite de esta acción.", 413);
    const content = new Uint8Array(await object.arrayBuffer());
    const entry: History = {
      id: confirmation.confirmationId,
      action: input.action,
      provider: destination,
      version: file.version,
      status: "unknown",
      createdAt: new Date().toISOString(),
      actorId: c.get("principalId"),
      actorName: bridge.actorName,
    };
    const key = `document-delivery:${file.id}:${entry.createdAt}:${confirmation.confirmationId}`;
    // A deterministic claim key prevents concurrent or repeated submissions.
    const claimKey = `document-confirmation:${confirmation.confirmationId}`;
    const claim = await db
      .prepare(
        "INSERT INTO studio_requests(tenant_id,request_key,fingerprint,response) VALUES (?,?,?,?) ON CONFLICT(tenant_id,request_key) DO NOTHING RETURNING request_key",
      )
      .bind(tenant, claimKey, c.get("principalId"), "{}")
      .first();
    if (!claim)
      return fail(
        "Esta confirmación ya fue utilizada. Revisa el historial antes de volver a enviar.",
        409,
      );
    await db
      .prepare(
        "INSERT INTO studio_requests(tenant_id,request_key,fingerprint,response) VALUES (?,?,?,?)",
      )
      .bind(tenant, key, c.get("principalId"), JSON.stringify(entry))
      .run();
    let webUrl: string | null = null;
    try {
      if (input.action === "onedrive")
        webUrl = (
          await bridge.saveCopy({
            provider: input.provider,
            connectionKey: String(payload.connectionId),
            folderId: input.folderId,
            name: input.name,
            mimeType: file.mime,
            content,
          })
        ).webUrl;
      else
        await bridge.sendEmail({
          connectionKey: String(payload.connectionId),
          to: input.to,
          subject: input.subject,
          body: input.body,
          file: { name: file.name, mimeType: file.mime, content },
        });
    } catch {
      return fail(
        "No se pudo confirmar el resultado. Revisa Outlook o OneDrive antes de volver a intentarlo para evitar duplicados.",
        502,
      );
    }
    entry.status = "succeeded";
    try {
      await db.batch([
        db
          .prepare(
            "UPDATE studio_requests SET response=? WHERE tenant_id=? AND request_key=?",
          )
          .bind(JSON.stringify(entry), tenant, key),
        audit(
          db,
          tenant,
          "document." + (input.action === "outlook" ? "submitted" : "copied"),
          file.object_name,
          file.record_id,
          {
            fileId: file.id,
            version: file.version,
            provider: destination,
            actorId: entry.actorId,
          },
        ),
      ]);
    } catch {
      return fail(
        "Microsoft aceptó la operación, pero no se pudo actualizar el historial. Comprueba el destino antes de repetirla.",
        502,
      );
    }
    return c.json({
      data: { action: input.action, status: "succeeded" as const, webUrl },
    });
  });
}
