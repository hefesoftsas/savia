import type { Hono, Context } from "hono";
import { z } from "zod";
import type { Env } from "./context";
import { fail } from "./context";
import { getObject, getRecord, guard, transaction, audit } from "./services";
import {
  r2AttachmentPolicy,
  R2_ATTACHMENT_TYPE,
} from "@savia/crm-shared/metadata";
import {
  officeFormat,
  OFFICE_FORMATS,
  OFFICE_MAX_SIZE,
  validateOfficePackage,
} from "@savia/crm-shared/office";
type FileRow = {
  id: string;
  object_name: string;
  record_id: string;
  field_name: string;
  name: string;
  mime: string;
  size: number;
  version: number;
  storage_key: string;
  created_at: string;
};
async function fileContext(c: Context<Env>) {
  const tenant = c.get("tenant"),
    db = c.env.DB;
  const row = await db
    .prepare("SELECT * FROM crm_files WHERE tenant_id=? AND id=?")
    .bind(tenant, c.req.param("id"))
    .first<FileRow>();
  if (!row) return fail("El adjunto no existe.", 404);
  const definition = await getObject(db, tenant, row.object_name);
  const record = await getRecord(db, tenant, row.object_name, row.record_id);
  const field = row.field_name
    ? definition.config.fields[row.field_name]
    : undefined;
  if (row.field_name && field?.type !== R2_ATTACHMENT_TYPE)
    return fail("El campo de archivo ya no existe.", 404);
  const format = officeFormat(row.name, row.mime);
  if (!format)
    return fail("Este archivo no admite edición. Usa DOCX, XLSX o PPTX.", 422);
  const policy = r2AttachmentPolicy(
    field?.config as Record<string, unknown> | undefined,
  );
  return { row, record, field, format, policy, tenant, db };
}
export function registerOfficeFiles(app: Hono<Env>) {
  app.get("/api/file/:id/office", async (c) => {
    const { row, field, policy } = await fileContext(c);
    return c.json({
      data: {
        id: row.id,
        name: row.name,
        mime: row.mime,
        size: row.size,
        version: row.version,
        field: row.field_name,
        object: row.object_name,
        recordId: row.record_id,
        readOnly: Boolean(field?.readOnly),
        maxSize: Math.min(policy.maxSize, OFFICE_MAX_SIZE),
      },
    });
  });
  app.get("/api/file/:id/revisions", async (c) => {
    const { row, db, tenant } = await fileContext(c);
    const { results } = await db
      .prepare(
        "SELECT version,size,created_at,created_by FROM crm_file_revisions WHERE tenant_id=? AND file_id=? ORDER BY version DESC",
      )
      .bind(tenant, row.id)
      .all();
    return c.json({
      data: results.length
        ? results
        : [
            {
              version: row.version,
              size: row.size,
              created_at: row.created_at,
              created_by: null,
            },
          ],
    });
  });
  app.get("/api/file/:id/revisions/:version/download", async (c) => {
    const { row, db, tenant } = await fileContext(c);
    const version = z.coerce
      .number()
      .int()
      .positive()
      .parse(c.req.param("version"));
    const revision = await db
      .prepare(
        "SELECT storage_key FROM crm_file_revisions WHERE tenant_id=? AND file_id=? AND version=?",
      )
      .bind(tenant, row.id, version)
      .first<{ storage_key: string }>();
    const key =
      revision?.storage_key ??
      (version === row.version ? row.storage_key : null);
    if (!key) return fail("La versión no existe.", 404);
    const object = await c.env.FILES.get(key);
    if (!object)
      return fail("No se encontró el contenido de esta versión.", 404);
    return new Response(object.body, {
      headers: {
        "Content-Type": row.mime,
        "Content-Length": String(object.size),
        "Content-Disposition":
          "attachment; filename*=UTF-8''" + encodeURIComponent(row.name),
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
  app.post("/api/file/:id/revisions", async (c) => {
    const { row, record, field, format, policy, tenant, db } =
      await fileContext(c);
    if (field?.readOnly) return fail("Este campo es de solo lectura.", 403);
    const form = await c.req.formData();
    const version = z.coerce
      .number()
      .int()
      .positive()
      .parse(form.get("version"));
    if (version !== row.version)
      return fail(
        "Hay una versión más reciente. Descarga tus cambios antes de volver a abrir el archivo.",
        409,
      );
    const file = form.get("file");
    if (!file || typeof file === "string")
      return fail("Selecciona el archivo editado.", 422);
    if (!file.size || file.size > Math.min(policy.maxSize, OFFICE_MAX_SIZE))
      return fail(
        "El archivo supera el tamaño permitido para este campo.",
        413,
      );
    if (officeFormat(file.name, file.type) !== format)
      return fail("Conserva el formato original del documento.", 422);
    const mime = OFFICE_FORMATS[format].mime;
    if (
      policy.accept.length &&
      !policy.accept.some(
        (a) =>
          a === mime || (a.endsWith("/*") && mime.startsWith(a.slice(0, -1))),
      )
    )
      return fail("El campo ya no admite este tipo de archivo.", 422);
    const bytes = new Uint8Array(await file.arrayBuffer());
    try {
      await validateOfficePackage(bytes, format);
    } catch {
      return fail(
        "El archivo Office está dañado o contiene elementos no admitidos.",
        422,
      );
    }
    const key =
      tenant +
      "/" +
      row.record_id +
      "/" +
      row.id +
      "/revisions/" +
      crypto.randomUUID();
    await c.env.FILES.put(key, bytes, { httpMetadata: { contentType: mime } });
    const gate = guard(
      db,
      "SELECT f.version=? AND r.version=? AND r.deleted_at IS NULL FROM crm_files f JOIN crm_records r ON r.tenant_id=f.tenant_id AND r.id=f.record_id WHERE f.tenant_id=? AND f.id=?",
      [version, record._version, tenant, row.id],
    );
    try {
      await transaction(db, [
        gate.start,
        db
          .prepare(
            "INSERT INTO crm_file_revisions(tenant_id,file_id,version,storage_key,size,created_at,created_by) VALUES (?,?,?,?,?,?,NULL) ON CONFLICT DO NOTHING",
          )
          .bind(
            tenant,
            row.id,
            row.version,
            row.storage_key,
            row.size,
            row.created_at,
          ),
        db
          .prepare(
            "INSERT INTO crm_file_revisions(tenant_id,file_id,version,storage_key,size,created_by) VALUES (?,?,?,?,?,?)",
          )
          .bind(
            tenant,
            row.id,
            version + 1,
            key,
            file.size,
            c.get("principalId") || null,
          ),
        db
          .prepare(
            "UPDATE crm_files SET storage_key=?,size=?,mime=?,version=version+1 WHERE tenant_id=? AND id=? AND version=?",
          )
          .bind(key, file.size, mime, tenant, row.id, version),
        audit(db, tenant, "file.revised", row.object_name, row.record_id, {
          fileId: row.id,
          version: version + 1,
          actor: c.get("principalId"),
          size: file.size,
        }),
        gate.end,
      ]);
    } catch (error) {
      // A transport failure may hide a committed batch. Never delete referenced bytes.
      const committed = await db
        .prepare("SELECT 1 FROM crm_file_revisions WHERE storage_key=?")
        .bind(key)
        .first();
      if (!committed) await c.env.FILES.delete(key);
      throw error;
    }
    return c.json(
      {
        data: {
          id: row.id,
          name: row.name,
          mime,
          size: file.size,
          version: version + 1,
        },
      },
      201,
    );
  });
}
