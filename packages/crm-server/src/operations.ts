import { dialectFor } from "@savia/db/dialect";
import type { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { Env } from "./context";
import {
  getObject,
  assertLocalCollection,
  getRecord,
  createRecord,
  parseRecord,
  audit,
  guard,
  transaction,
} from "./services";
import {
  type CrmObject,
  type CrmRecord,
  identifier,
  getPipeline,
  R2_ATTACHMENT_TYPE,
  r2AttachmentPolicy,
  validateRecord,
} from "@savia/crm-shared/metadata";
import {
  parseCsv,
  mapCsvRow,
  csvHeaders,
  csvLine,
} from "@savia/crm-shared/csv";
import { buildWhere } from "./query";
import { policyFor, accessDenied, accessRecord } from "./access-authorization";
import { decideWrite } from "@savia/crm-shared/access-evaluator";
import {
  formatRecordCsvValue,
  parseCsvExportColumns,
  recordsCsvFilename,
} from "@savia/crm-shared/records-csv-export";

const fail = (
  message: string,
  status: 400 | 404 | 409 | 413 | 422 | 503 = 400,
): never => {
  throw new HTTPException(status, { message });
};
const pageSize = 20;
const pageNumber = (value?: string) =>
  Math.max(1, Math.floor(Number(value) || 1));
const versionSchema = z.object({ version: z.number().int().positive() });
const now = () => new Date().toISOString();
const parseObject = (r: any): CrmObject => ({
  ...r,
  config: JSON.parse(r.config),
});
const automationSchema = z.object({
  name: z.string().trim().min(1).max(100),
  object_name: identifier,
  config: z.object({
    field: identifier,
    value: z.union([z.string().max(500), z.number(), z.boolean()]),
    title: z.string().trim().min(1).max(200),
    dueDays: z.number().int().min(0).max(365),
    owner: z.string().max(100).default(""),
    ownerField: z.string().max(48).default(""),
  }),
  enabled: z.boolean().default(true),
});
const temporaryAttachmentLifetimeMs = 24 * 60 * 60 * 1000;
const temporaryExpiresAt = () =>
  new Date(Date.now() + temporaryAttachmentLifetimeMs).toISOString();

async function purgeExpiredTemporaryAttachments(
  db: D1Database,
  files: R2Bucket,
  tenant: string,
) {
  const { results } = await db
    .prepare(
      "SELECT id,storage_key FROM crm_file_drafts WHERE tenant_id=? AND expires_at<=?",
    )
    .bind(tenant, now())
    .all<{ id: string; storage_key: string }>();
  if (!results.length) return;
  await Promise.all(results.map((row) => files.delete(row.storage_key)));
  await db.batch(
    results.map((row) =>
      db
        .prepare("DELETE FROM crm_file_drafts WHERE tenant_id=? AND id=?")
        .bind(tenant, row.id),
    ),
  );
}

export type AutomationRuleSnapshot = {
  id: string;
  version: number;
  name: string;
  config: string;
};

/** Each rule/version/record version creates at most one task, even when delivery is repeated. */
export async function runAutomations(
  db: D1Database,
  tenant: string,
  objectName: string,
  before: CrmRecord | null,
  after: CrmRecord,
  scope?: { ruleId?: string; rules?: AutomationRuleSnapshot[] },
) {
  if (policyFor(db)) return { delivered: false };
  await assertLocalCollection(db, tenant, objectName);
  const results =
    scope?.rules ??
    (
      await db
        .prepare(
          "SELECT * FROM crm_automations WHERE tenant_id=? AND object_name=? AND enabled=1",
        )
        .bind(tenant, objectName)
        .all<AutomationRuleSnapshot>()
    ).results;
  let delivered = true;
  for (const rule of results) {
    if (scope?.ruleId && rule.id !== scope.ruleId) continue;
    const config = JSON.parse(rule.config);
    if (
      JSON.stringify(before?.[config.field]) ===
        JSON.stringify(after[config.field]) ||
      String(after[config.field] ?? "") !== String(config.value)
    )
      continue;
    const eventKey = `${after.id}:${after._version}:${rule.version}`;
    const taskId = `auto:${rule.id}:${eventKey}`;
    if (
      await db
        .prepare(
          "SELECT id FROM crm_automation_runs WHERE tenant_id=? AND automation_id=? AND event_key=? AND status='success'",
        )
        .bind(tenant, rule.id, eventKey)
        .first()
    )
      continue;
    try {
      const due = new Date();
      due.setUTCDate(due.getUTCDate() + config.dueDays);
      const title = config.title
        .replace(/\{\{([a-z][a-z0-9_]*)\}\}/g, (_: string, field: string) =>
          String(after[field] ?? ""),
        )
        .slice(0, 200);
      const owner = config.ownerField
        ? String(after[config.ownerField] ?? config.owner)
        : config.owner;
      await db.batch([
        db
          .prepare(
            "INSERT INTO crm_tasks (id,tenant_id,object_name,record_id,title,owner,due_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT DO NOTHING",
          )
          .bind(
            taskId,
            tenant,
            objectName,
            after.id,
            title,
            owner,
            due.toISOString().slice(0, 10),
          ),
        db
          .prepare(
            "INSERT INTO crm_automation_runs (id,tenant_id,automation_id,object_name,record_id,event_key,status,detail,task_id) VALUES (?,?,?,?,?,?,'success',?,?) ON CONFLICT(tenant_id,automation_id,event_key) DO UPDATE SET status='success',detail=excluded.detail,task_id=excluded.task_id",
          )
          .bind(
            crypto.randomUUID(),
            tenant,
            rule.id,
            objectName,
            after.id,
            eventKey,
            JSON.stringify({
              name: rule.name,
              field: config.field,
              value: after[config.field],
            }),
            taskId,
          ),
      ]);
    } catch (error) {
      delivered = false;
      await db
        .prepare(
          "INSERT INTO crm_automation_runs (id,tenant_id,automation_id,object_name,record_id,event_key,status,detail) VALUES (?,?,?,?,?,?,'failed',?) ON CONFLICT(tenant_id,automation_id,event_key) DO UPDATE SET status='failed',detail=excluded.detail",
        )
        .bind(
          crypto.randomUUID(),
          tenant,
          rule.id,
          objectName,
          after.id,
          eventKey,
          JSON.stringify({
            name: rule.name,
            error: (error as Error).message,
            after,
            before,
          }),
        )
        .run();
    }
  }
  return { delivered };
}

export function registerOperations(app: Hono<Env>) {
  app.get("/api/record-detail/:object/:id", async (c) => {
    const db = c.env.DB,
      tenant = c.get("tenant"),
      objectName = c.req.param("object"),
      id = c.req.param("id");
    const record = await getRecord(db, tenant, objectName, id);
    const { results: rawObjects } = await db
      .prepare("SELECT * FROM crm_objects WHERE tenant_id=? ORDER BY name")
      .bind(tenant)
      .all<any>();
    const objects = rawObjects.map(parseObject),
      page = pageNumber(c.req.query("page"));
    const relations: {
      object: string;
      label: string;
      field: string;
      fieldLabel: string;
      direction: string;
      total: number;
      records: CrmRecord[];
    }[] = [];
    for (const object of objects)
      for (const [fieldName, field] of Object.entries(object.config.fields)) {
        if (field.config?.relation === objectName) {
          const path = `$.${identifier.parse(fieldName)}`;
          const comparison = dialectFor(db).jsonCompare("data", path, "eq", id);
          const where = `tenant_id=? AND object_name=? AND deleted_at IS NULL AND (${comparison.sql} OR EXISTS(SELECT 1 FROM ${dialectFor(db).jsonEach("data", path, "related")} WHERE value=?))`;
          const args = [tenant, object.name, ...comparison.parameters, id];
          const count = await db
            .prepare(`SELECT COUNT(*) AS total FROM crm_records WHERE ${where}`)
            .bind(...args)
            .first<{ total: number }>();
          const { results } = await db
            .prepare(
              `SELECT * FROM crm_records WHERE ${where} ORDER BY updated_at DESC,id LIMIT ? OFFSET ?`,
            )
            .bind(...args, pageSize, (page - 1) * pageSize)
            .all();
          relations.push({
            object: object.name,
            label: object.label,
            field: fieldName,
            fieldLabel: field.label,
            direction: "incoming",
            total: count?.total ?? 0,
            records: results.map(parseRecord),
          });
        }
        if (
          object.name === objectName &&
          typeof field.config?.relation === "string"
        ) {
          const value = record[fieldName];
          const ids = (
            Array.isArray(value) ? value : value ? [value] : []
          ).filter((v): v is string => typeof v === "string");
          const related = objects.find(
            (o) => o.name === field.config?.relation,
          );
          const { results } = await db
            .prepare(
              `SELECT * FROM crm_records WHERE tenant_id=? AND object_name=? AND deleted_at IS NULL AND id IN (SELECT value FROM (SELECT ? AS ids) input, ${dialectFor(db).jsonEach("input.ids", "$", "related")}) ORDER BY id LIMIT ? OFFSET ?`,
            )
            .bind(
              tenant,
              field.config.relation,
              JSON.stringify(ids),
              pageSize,
              (page - 1) * pageSize,
            )
            .all();
          relations.push({
            object: String(field.config.relation),
            label: related?.label ?? String(field.config.relation),
            field: fieldName,
            fieldLabel: field.label,
            direction: "outgoing",
            total: ids.length,
            records: results.map(parseRecord),
          });
        }
      }
    return c.json({ data: { record, relations, page, perPage: pageSize } });
  });
  app.get("/api/record-activity/:object/:id", async (c) => {
    const db = c.env.DB,
      tenant = c.get("tenant"),
      object = c.req.param("object"),
      id = c.req.param("id");
    await getRecord(db, tenant, object, id);
    const page = pageNumber(c.req.query("page"));
    const union =
      "SELECT id,body,kind,version,created_at FROM crm_notes WHERE tenant_id=? AND object_name=? AND record_id=? UNION ALL SELECT id,detail AS body,action AS kind,0 AS version,created_at FROM crm_audit WHERE tenant_id=? AND object_name=? AND record_id=?";
    const args = [tenant, object, id, tenant, object, id];
    const { results } = await db
      .prepare(
        `SELECT * FROM (${union}) ORDER BY created_at DESC,id LIMIT ? OFFSET ?`,
      )
      .bind(...args, pageSize, (page - 1) * pageSize)
      .all();
    const total = await db
      .prepare(`SELECT count(*) AS total FROM (${union})`)
      .bind(...args)
      .first<{ total: number }>();
    return c.json({ data: results, total: total?.total ?? 0, page });
  });
  app.post("/api/record-notes/:object/:id", async (c) => {
    const input = z
      .object({
        body: z.string().trim().min(1).max(10000),
        kind: z.enum(["note", "call", "meeting", "email"]).default("note"),
      })
      .parse(await c.req.json());
    const db = c.env.DB,
      tenant = c.get("tenant"),
      object = c.req.param("object"),
      recordId = c.req.param("id");
    await getRecord(db, tenant, object, recordId);
    const id = crypto.randomUUID();
    await db
      .prepare(
        "INSERT INTO crm_notes (id,tenant_id,object_name,record_id,body,kind) VALUES (?,?,?,?,?,?)",
      )
      .bind(id, tenant, object, recordId, input.body, input.kind)
      .run();
    return c.json({ data: { id, ...input, version: 1 } }, 201);
  });
  app.delete("/api/record-notes/:id", async (c) => {
    const { version } = versionSchema.parse(await c.req.json());
    const result = await c.env.DB.prepare(
      "DELETE FROM crm_notes WHERE tenant_id=? AND id=? AND version=?",
    )
      .bind(c.get("tenant"), c.req.param("id"), version)
      .run();
    if (!result.meta.changes)
      return fail("La nota cambió o ya no existe. Actualiza la ficha.", 409);
    return c.json({ ok: true });
  });
  app.get("/api/files/:object/:recordId", async (c) => {
    const field = c.req.query("field");
    if (field !== undefined && !identifier.safeParse(field).success)
      return fail("Campo de archivo inválido.", 422);
    await getRecord(
      c.env.DB,
      c.get("tenant"),
      c.req.param("object"),
      c.req.param("recordId"),
    );
    const { results } = await c.env.DB.prepare(
      `SELECT id,name,mime,size,field_name AS field,version,created_at
         FROM crm_files
         WHERE tenant_id=? AND object_name=? AND record_id=?${field ? " AND field_name=?" : ""}
         ORDER BY created_at DESC`,
    )
      .bind(
        c.get("tenant"),
        c.req.param("object"),
        c.req.param("recordId"),
        ...(field ? [field] : []),
      )
      .all();
    return c.json({ data: results });
  });
  app.post("/api/file-drafts/:object", async (c) => {
    const db = c.env.DB,
      tenant = c.get("tenant"),
      object = c.req.param("object");
    const definition = await getObject(db, tenant, object);
    if (!c.env.FILES)
      return fail("El almacenamiento de archivos no está configurado.", 503);
    await purgeExpiredTemporaryAttachments(db, c.env.FILES, tenant);
    const form = await c.req.formData();
    const file = form.get("file");
    const fieldValue = form.get("field");
    const field = typeof fieldValue === "string" ? fieldValue : "";
    if (!file || typeof file === "string")
      return fail("Selecciona un archivo.", 422);
    if (!field || !identifier.safeParse(field).success)
      return fail("Campo de archivo inválido.", 422);
    const fieldDefinition = definition.config.fields[field];
    if (fieldDefinition?.type !== R2_ATTACHMENT_TYPE)
      return fail("El campo no admite archivos R2.", 422);
    const policy = r2AttachmentPolicy(
      fieldDefinition.config as Record<string, unknown>,
    );
    const mime = file.type || "application/octet-stream";
    if (!file.size || file.size > policy.maxSize)
      return fail(
        `El archivo debe pesar entre 1 byte y ${Math.ceil(policy.maxSize / (1024 * 1024))} MB.`,
        413,
      );
    const acceptsMime = policy.accept.some(
      (accepted) =>
        accepted === mime ||
        (accepted.endsWith("/*") && mime.startsWith(accepted.slice(0, -1))),
    );
    if (policy.accept.length && !acceptsMime)
      return fail("El tipo de archivo no está permitido para este campo.", 422);
    const name =
      file.name.replace(/[\x00-\x1f\x7f/\\\\]/g, "_").slice(0, 200) ||
      "adjunto";
    const id = crypto.randomUUID();
    const key = `${tenant}/temporary/${id}`;
    const expiresAt = temporaryExpiresAt();
    await c.env.FILES.put(key, await file.arrayBuffer(), {
      httpMetadata: { contentType: mime },
    });
    try {
      await transaction(db, [
        db
          .prepare(
            "INSERT INTO crm_file_drafts (id,tenant_id,object_name,field_name,name,mime,size,storage_key,expires_at) VALUES (?,?,?,?,?,?,?,?,?)",
          )
          .bind(
            id,
            tenant,
            object,
            field,
            name,
            mime,
            file.size,
            key,
            expiresAt,
          ),
        audit(db, tenant, "file.temporary_uploaded", object, null, {
          field,
          name,
          size: file.size,
          expiresAt,
        }),
      ]);
    } catch (error) {
      await c.env.FILES.delete(key);
      throw error;
    }
    return c.json(
      {
        data: {
          id,
          name,
          mime,
          size: file.size,
          field,
          version: 1,
          expiresAt,
        },
      },
      201,
    );
  });
  app.post("/api/files/:object/:recordId", async (c) => {
    const db = c.env.DB,
      tenant = c.get("tenant"),
      object = c.req.param("object"),
      recordId = c.req.param("recordId");
    const definition = await getObject(db, tenant, object);
    await getRecord(db, tenant, object, recordId);
    if (!c.env.FILES)
      return fail("El almacenamiento de archivos no está configurado.", 503);
    const form = await c.req.formData();
    const file = form.get("file");
    const fieldValue = form.get("field");
    const field = typeof fieldValue === "string" ? fieldValue : "";
    if (!file || typeof file === "string")
      return fail("Selecciona un archivo.", 422);
    if (field && !identifier.safeParse(field).success)
      return fail("Campo de archivo inválido.", 422);
    const fieldDefinition = field ? definition.config.fields[field] : undefined;
    if (field && fieldDefinition?.type !== R2_ATTACHMENT_TYPE)
      return fail("El campo no admite archivos R2.", 422);
    const policy = fieldDefinition
      ? r2AttachmentPolicy(fieldDefinition.config as Record<string, unknown>)
      : { maxFiles: 50, maxSize: 5 * 1024 * 1024, accept: [] };
    const mime = file.type || "application/octet-stream";
    if (!file.size || file.size > policy.maxSize)
      return fail(
        `El archivo debe pesar entre 1 byte y ${Math.ceil(policy.maxSize / (1024 * 1024))} MB.`,
        413,
      );
    const acceptsMime = policy.accept.some(
      (accepted) =>
        accepted === mime ||
        (accepted.endsWith("/*") && mime.startsWith(accepted.slice(0, -1))),
    );
    if (policy.accept.length && !acceptsMime)
      return fail("El tipo de archivo no está permitido para este campo.", 422);
    const count = await db
      .prepare(
        "SELECT count(*) AS total FROM crm_files WHERE tenant_id=? AND record_id=?",
      )
      .bind(tenant, recordId)
      .first<{ total: number }>();
    if ((count?.total ?? 0) >= 50)
      return fail("Máximo 50 adjuntos por registro.", 422);
    if (field) {
      const fieldCount = await db
        .prepare(
          "SELECT count(*) AS total FROM crm_files WHERE tenant_id=? AND object_name=? AND record_id=? AND field_name=?",
        )
        .bind(tenant, object, recordId, field)
        .first<{ total: number }>();
      if ((fieldCount?.total ?? 0) >= policy.maxFiles)
        return fail("Máximo de archivos alcanzado para este campo.", 422);
    }
    const name =
      file.name.replace(/[\x00-\x1f\x7f/\\]/g, "_").slice(0, 200) || "adjunto";
    const id = crypto.randomUUID(),
      key = `${tenant}/${recordId}/${id}`;
    await c.env.FILES.put(key, await file.arrayBuffer(), {
      httpMetadata: { contentType: mime },
    });
    try {
      const limitGuard = guard(
        db,
        "SELECT count(*)<50 FROM crm_files WHERE tenant_id=? AND record_id=?",
        [tenant, recordId],
      );
      await transaction(db, [
        limitGuard.start,
        db
          .prepare(
            "INSERT INTO crm_files (id,tenant_id,object_name,record_id,field_name,name,mime,size,storage_key) VALUES (?,?,?,?,?,?,?,?,?)",
          )
          .bind(
            id,
            tenant,
            object,
            recordId,
            field,
            name,
            mime,
            file.size,
            key,
          ),
        audit(db, tenant, "file.uploaded", object, recordId, {
          field,
          name,
          size: file.size,
        }),
        limitGuard.end,
      ]);
    } catch (error) {
      await c.env.FILES.delete(key);
      throw error;
    }
    return c.json(
      { data: { id, name, mime, size: file.size, field, version: 1 } },
      201,
    );
  });
  app.post("/api/file-drafts/:id/attach", async (c) => {
    const input = z
      .object({
        recordId: z.string().trim().min(1).max(200),
        version: z.number().int().positive(),
      })
      .parse(await c.req.json());
    const db = c.env.DB,
      tenant = c.get("tenant");
    if (!c.env.FILES)
      return fail("El almacenamiento de archivos no está configurado.", 503);
    await purgeExpiredTemporaryAttachments(db, c.env.FILES, tenant);
    const row = await db
      .prepare("SELECT * FROM crm_file_drafts WHERE tenant_id=? AND id=?")
      .bind(tenant, c.req.param("id"))
      .first<any>();
    if (!row) return fail("El adjunto temporal no existe o expiró.", 404);
    if (row.version !== input.version)
      return fail("El adjunto cambió. Actualiza la ficha.", 409);
    const definition = await getObject(db, tenant, row.object_name);
    const fieldDefinition = definition.config.fields[row.field_name];
    if (fieldDefinition?.type !== R2_ATTACHMENT_TYPE)
      return fail("El campo ya no admite archivos R2.", 422);
    await getRecord(db, tenant, row.object_name, input.recordId);
    const policy = r2AttachmentPolicy(
      fieldDefinition.config as Record<string, unknown>,
    );
    const total = await db
      .prepare(
        "SELECT count(*) AS total FROM crm_files WHERE tenant_id=? AND record_id=?",
      )
      .bind(tenant, input.recordId)
      .first<{ total: number }>();
    if ((total?.total ?? 0) >= 50)
      return fail("Máximo 50 adjuntos por registro.", 422);
    const fieldTotal = await db
      .prepare(
        "SELECT count(*) AS total FROM crm_files WHERE tenant_id=? AND object_name=? AND record_id=? AND field_name=?",
      )
      .bind(tenant, row.object_name, input.recordId, row.field_name)
      .first<{ total: number }>();
    if ((fieldTotal?.total ?? 0) >= policy.maxFiles)
      return fail("Máximo de archivos alcanzado para este campo.", 422);
    const nextVersion = row.version + 1;
    await transaction(db, [
      db
        .prepare(
          "INSERT INTO crm_files (id,tenant_id,object_name,record_id,field_name,name,mime,size,storage_key,version) VALUES (?,?,?,?,?,?,?,?,?,?)",
        )
        .bind(
          row.id,
          tenant,
          row.object_name,
          input.recordId,
          row.field_name,
          row.name,
          row.mime,
          row.size,
          row.storage_key,
          nextVersion,
        ),
      db
        .prepare(
          "DELETE FROM crm_file_drafts WHERE tenant_id=? AND id=? AND version=?",
        )
        .bind(tenant, row.id, row.version),
      audit(db, tenant, "file.attached", row.object_name, input.recordId, {
        field: row.field_name,
        name: row.name,
        temporaryId: row.id,
      }),
    ]);
    return c.json({
      data: {
        id: row.id,
        name: row.name,
        mime: row.mime,
        size: row.size,
        field: row.field_name,
        recordId: input.recordId,
        version: nextVersion,
      },
    });
  });
  app.get("/api/file/:id/download", async (c) => {
    const row = await c.env.DB.prepare(
      "SELECT id,name,storage_key,object_name,NULL AS expires_at,0 AS temporary FROM crm_files WHERE tenant_id=? AND id=? UNION ALL SELECT id,name,storage_key,object_name,expires_at,1 AS temporary FROM crm_file_drafts WHERE tenant_id=? AND id=? LIMIT 1",
    )
      .bind(
        c.get("tenant"),
        c.req.param("id"),
        c.get("tenant"),
        c.req.param("id"),
      )
      .first<any>();
    if (!row) return fail("El adjunto no existe.", 404);
    await getObject(c.env.DB, c.get("tenant"), row.object_name);
    if (row.temporary && row.expires_at && String(row.expires_at) <= now()) {
      await c.env.FILES.delete(row.storage_key);
      await c.env.DB.prepare(
        "DELETE FROM crm_file_drafts WHERE tenant_id=? AND id=?",
      )
        .bind(c.get("tenant"), row.id)
        .run();
      return fail("El adjunto temporal expiró.", 404);
    }
    const file = await c.env.FILES.get(row.storage_key);
    if (!file)
      return fail(
        "No se encontró el contenido del archivo. Puedes eliminar la referencia y cargarlo nuevamente.",
        404,
      );
    return new Response(file.body, {
      headers: {
        "Content-Type": "application/octet-stream",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(row.name)}`,
        "Content-Length": String(file.size),
      },
    });
  });
  app.delete("/api/file/:id", async (c) => {
    const { version } = versionSchema.parse(await c.req.json()),
      db = c.env.DB,
      tenant = c.get("tenant");
    const row = await db
      .prepare("SELECT * FROM crm_files WHERE tenant_id=? AND id=?")
      .bind(tenant, c.req.param("id"))
      .first<any>();
    const draft = row
      ? null
      : await db
          .prepare("SELECT * FROM crm_file_drafts WHERE tenant_id=? AND id=?")
          .bind(tenant, c.req.param("id"))
          .first<any>();
    const file = row ?? draft;
    if (!file) return c.json({ ok: true });
    if (file.version !== version)
      return fail("El adjunto cambió. Actualiza la ficha.", 409);
    const revisions = row
      ? await db
          .prepare(
            "SELECT storage_key FROM crm_file_revisions WHERE tenant_id=? AND file_id=?",
          )
          .bind(tenant, file.id)
          .all<{ storage_key: string }>()
      : { results: [] };
    const gate = guard(
      db,
      row
        ? "SELECT version=? FROM crm_files WHERE tenant_id=? AND id=?"
        : "SELECT version=? FROM crm_file_drafts WHERE tenant_id=? AND id=?",
      [version, tenant, file.id],
    );
    await transaction(db, [
      gate.start,
      db
        .prepare(
          row
            ? "DELETE FROM crm_files WHERE tenant_id=? AND id=? AND version=?"
            : "DELETE FROM crm_file_drafts WHERE tenant_id=? AND id=? AND version=?",
        )
        .bind(tenant, file.id, version),
      audit(
        db,
        tenant,
        row ? "file.deleted" : "file.temporary_deleted",
        file.object_name,
        row ? row.record_id : null,
        {
          name: file.name,
        },
      ),
      gate.end,
    ]);
    // Remove bytes only after the version-checked deletion commits.
    const keys = [
      ...new Set([
        file.storage_key,
        ...revisions.results.map((r) => r.storage_key),
      ]),
    ];
    for (let offset = 0; offset < keys.length; offset += 1000)
      await c.env.FILES.delete(keys.slice(offset, offset + 1000));
    return c.json({ ok: true });
  });

  const importSchema = z.object({
    csv: z.string().max(1024 * 1024),
    mapping: z.record(z.string(), z.string()),
    duplicateField: z.string().default(""),
    duplicatePolicy: z.enum(["skip", "error"]).default("skip"),
    importId: z.string().uuid().optional(),
  });
  async function importRows(c: any, commit: boolean) {
    const input = importSchema.parse(await c.req.json()),
      db = c.env.DB as D1Database,
      tenant = c.get("tenant"),
      objectName = c.req.param("object");
    const object = await getObject(db, tenant, objectName);
    let parsed;
    try {
      parsed = parseCsv(input.csv);
    } catch (e) {
      return fail((e as Error).message, 422);
    }
    const mapped = Object.values(input.mapping).filter(Boolean);
    if (
      !mapped.length ||
      new Set(mapped).size !== mapped.length ||
      mapped.some((key) => !object.config.fields[key])
    )
      return fail(
        "Asigna columnas a campos válidos sin repetir destinos.",
        422,
      );
    if (input.duplicateField && !object.config.fields[input.duplicateField])
      return fail("Campo para duplicados inválido.", 422);
    if (commit && !input.importId)
      return fail(
        "La importación necesita un identificador. Previsualiza nuevamente.",
        422,
      );
    const duplicateFields = [
      ...new Set([
        ...(input.duplicateField ? [input.duplicateField] : []),
        ...Object.entries(object.config.fields)
          .filter(([, f]) => f.config?.unique)
          .map(([name]) => name),
      ]),
    ];
    const seen = new Set<string>();
    const results: {
      row: number;
      status: string;
      data?: unknown;
      error?: string;
      id?: string;
    }[] = [];
    for (const [index, values] of parsed.rows.entries()) {
      const { data, errors } = mapCsvRow(
        object,
        parsed.headers,
        values,
        input.mapping,
      );
      const policy = policyFor(db);
      if (policy) {
        const importPolicy = {
          ...policy,
          grants: policy.grants
            .filter((g) => g.action === "import")
            .map((g) => ({ ...g, action: "create" as const })),
        };
        if (
          !decideWrite(
            importPolicy,
            `collection:${objectName}`,
            "create",
            null,
            {
              id: "import-preview",
              createdBy: policy.principalId,
              values: data,
            },
            Object.keys(data),
          ).allowed
        )
          accessDenied();
        for (const [field, config] of Object.entries(object.config.fields))
          if (config.config?.relation && data[field])
            for (const id of Array.isArray(data[field])
              ? (data[field] as unknown[])
              : [data[field]])
              await getRecord(
                db,
                tenant,
                String(config.config.relation),
                String(id),
              );
      }
      if (Object.keys(errors).length) {
        results.push({
          row: index + 2,
          status: "error",
          error: Object.values(errors).join(" "),
          data,
        });
        continue;
      }
      let duplicate = "";
      for (const field of duplicateFields) {
        const value = data[field];
        if (value === null || value === undefined || value === "") continue;
        const normalized =
          typeof value === "string" ? value.trim().toLocaleLowerCase() : value;
        const key = `${field}:${JSON.stringify(normalized)}`;
        const row = await db
          .prepare(
            `SELECT id FROM crm_records WHERE tenant_id=? AND object_name=? AND deleted_at IS NULL AND LOWER(TRIM(${dialectFor(db).jsonText("data", `$.${field}`)}))=? LIMIT 1`,
          )
          .bind(
            tenant,
            objectName,
            String(
              typeof value === "boolean"
                ? Number(value)
                : typeof value === "object"
                  ? JSON.stringify(value)
                  : value,
            )
              .trim()
              .toLowerCase(),
          )
          .first<{ id: string }>();
        if (seen.has(key) || row) {
          duplicate = `${object.config.fields[field].label}: valor duplicado (${String(value)}).`;
          break;
        }
      }
      // Relation checks also run during preview, not only while committing.
      for (const [field, config] of Object.entries(object.config.fields))
        if (config.config?.relation && data[field]) {
          const ids = Array.isArray(data[field])
            ? (data[field] as unknown[])
            : [data[field]];
          for (const id of ids)
            if (
              !(await db
                .prepare(
                  "SELECT id FROM crm_records WHERE tenant_id=? AND object_name=? AND deleted_at IS NULL AND id=?",
                )
                .bind(tenant, String(config.config.relation), String(id))
                .first())
            )
              errors[field] =
                `${config.label}: registro relacionado inexistente (${id}).`;
        }
      if (Object.keys(errors).length) {
        results.push({
          row: index + 2,
          status: "error",
          error: Object.values(errors).join(" "),
          data,
        });
        continue;
      }
      if (duplicate) {
        results.push({
          row: index + 2,
          status: input.duplicatePolicy === "skip" ? "skipped" : "error",
          error: duplicate,
          data,
        });
        continue;
      }
      for (const field of duplicateFields)
        if (
          data[field] !== null &&
          data[field] !== undefined &&
          data[field] !== ""
        )
          seen.add(
            `${field}:${JSON.stringify(typeof data[field] === "string" ? (data[field] as string).trim().toLocaleLowerCase() : data[field])}`,
          );
      if (!commit) {
        results.push({ row: index + 2, status: "ready", data });
        continue;
      }
      try {
        const record = await createRecord(db, tenant, objectName, data, {
          idempotencyKey: `csv:${input.importId}:${index}`,
          createdBy: c.get("principalId"),
        });
        let warning: string | undefined;
        try {
          await runAutomations(db, tenant, objectName, null, record);
        } catch (e) {
          warning = `Registro creado; no se pudo ejecutar el seguimiento automático: ${(e as Error).message}`;
        }
        results.push({
          row: index + 2,
          status: "created",
          id: record.id,
          data,
          ...(warning ? { error: warning } : {}),
        });
      } catch (e) {
        results.push({
          row: index + 2,
          status: "error",
          error: (e as Error).message,
          data,
        });
      }
    }
    return c.json({
      data: results,
      headers: parsed.headers,
      total: results.length,
      importId: input.importId ?? crypto.randomUUID(),
      summary: {
        ready: results.filter((r) => r.status === "ready").length,
        created: results.filter((r) => r.status === "created").length,
        skipped: results.filter((r) => r.status === "skipped").length,
        errors: results.filter((r) => r.status === "error").length,
      },
    });
  }
  app.post("/api/import/:object/preview", (c) => importRows(c, false));
  app.post("/api/import/:object/commit", (c) => importRows(c, true));
  app.get("/api/export/:object", async (c) => {
    const db = c.env.DB,
      tenant = c.get("tenant"),
      objectName = c.req.param("object"),
      params = c.req.query(),
      object = await getObject(db, tenant, objectName),
      custom = parseCsvExportColumns(params, object);
    if (custom) {
      const { columns, headers: headerLabels } = custom;
      const { where, args } = buildWhere(
        object,
        tenant,
        params,
        undefined,
        dialectFor(db),
      );
      const total = await db
        .prepare(`SELECT count(*) AS total FROM crm_records WHERE ${where}`)
        .bind(...args)
        .first<{ total: number }>();
      if ((total?.total ?? 0) > 10_000)
        fail(
          "La exportación admite hasta 10.000 registros. Aplica filtros para reducir el resultado.",
        );
      const sort = params.sort ?? "updated_at";
      const order = params.order === "ASC" ? "ASC" : "DESC";
      if (
        !["created_at", "updated_at", "id"].includes(sort) &&
        !object.config.fields[sort]
      )
        fail("Campo de orden inválido.");
      const sortSql = ["created_at", "updated_at", "id"].includes(sort)
        ? sort
        : dialectFor(db).jsonSort("data", `$.${sort}`);
      const { results } = await db
        .prepare(
          `SELECT * FROM crm_records WHERE ${where} ORDER BY ${sortSql} ${order}, id ASC LIMIT 10000`,
        )
        .bind(...args)
        .all<any>();
      const csv =
        "\uFEFF" +
        csvLine(headerLabels) +
        results
          .map((row) => {
            const record = parseRecord(row);
            return csvLine(
              columns.map((key) => formatRecordCsvValue(record[key])),
            );
          })
          .join("");
      return new Response(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${recordsCsvFilename(objectName)}"`,
        },
      });
    }
    const headers = csvHeaders(object);
    // Cursor pagination avoids both a 100-row cap and offset drift during export.
    let cursor = "",
      finished = false;
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("\uFEFF" + csvLine(headers)));
      },
      async pull(controller) {
        if (finished) {
          controller.close();
          return;
        }
        try {
          const { results } = await db
            .prepare(
              "SELECT * FROM crm_records WHERE tenant_id=? AND object_name=? AND deleted_at IS NULL AND id>? ORDER BY id LIMIT 200",
            )
            .bind(tenant, objectName, cursor)
            .all<any>();
          if (!results.length) {
            finished = true;
            controller.close();
            return;
          }
          controller.enqueue(
            encoder.encode(
              results
                .map((row) => {
                  const record = parseRecord(row);
                  return csvLine(headers.map((key) => record[key]));
                })
                .join(""),
            ),
          );
          cursor = results[results.length - 1].id;
          if (results.length < 200) {
            finished = true;
            controller.close();
          }
        } catch (error) {
          controller.error(error);
        }
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${recordsCsvFilename(objectName)}"`,
      },
    });
  });

  app.get("/api/automations", async (c) => {
    const { results } = await c.env.DB.prepare(
      "SELECT * FROM crm_automations WHERE tenant_id=? ORDER BY created_at DESC,id",
    )
      .bind(c.get("tenant"))
      .all<any>();
    return c.json({
      data: results.map((r) => ({
        ...r,
        enabled: Boolean(r.enabled),
        config: JSON.parse(r.config),
      })),
    });
  });
  async function saveAutomation(c: any, edit: boolean) {
    const body = await c.req.json(),
      input = automationSchema.parse(body),
      db = c.env.DB as D1Database,
      tenant = c.get("tenant");
    await assertLocalCollection(db, tenant, input.object_name);
    const object = await getObject(db, tenant, input.object_name);
    if (!object.config.fields[input.config.field])
      return fail("Selecciona un campo existente.", 422);
    if (object.config.fields[input.config.field].config?.multiple)
      return fail("El disparador necesita un campo de valor simple.", 422);
    const triggerError = validateRecord(object, {
      [input.config.field]: input.config.value,
    }).errors[input.config.field];
    if (triggerError) return fail(triggerError, 422);
    if (
      input.config.ownerField &&
      !object.config.fields[input.config.ownerField]
    )
      return fail("El campo responsable no existe.", 422);
    const id = edit ? c.req.param("id") : crypto.randomUUID();
    if (edit) {
      const { version } = versionSchema.parse(body);
      const result = await db
        .prepare(
          "UPDATE crm_automations SET name=?,object_name=?,config=?,enabled=?,version=version+1 WHERE tenant_id=? AND id=? AND version=?",
        )
        .bind(
          input.name,
          input.object_name,
          JSON.stringify(input.config),
          Number(input.enabled),
          tenant,
          id,
          version,
        )
        .run();
      if (!result.meta.changes)
        return fail("La automatización cambió. Actualiza para continuar.", 409);
    } else
      await db
        .prepare(
          "INSERT INTO crm_automations (id,tenant_id,object_name,name,config,enabled) VALUES (?,?,?,?,?,?)",
        )
        .bind(
          id,
          tenant,
          input.object_name,
          input.name,
          JSON.stringify(input.config),
          Number(input.enabled),
        )
        .run();
    await audit(
      db,
      tenant,
      edit ? "automation.updated" : "automation.created",
      input.object_name,
      null,
      { id, name: input.name },
    ).run();
    return c.json({
      data: { id, ...input, version: edit ? body.version + 1 : 1 },
    });
  }
  app.post("/api/automations", (c) => saveAutomation(c, false));
  app.patch("/api/automations/:id", (c) => saveAutomation(c, true));
  app.delete("/api/automations/:id", async (c) => {
    const { version } = versionSchema.parse(await c.req.json());
    const result = await c.env.DB.prepare(
      "DELETE FROM crm_automations WHERE tenant_id=? AND id=? AND version=?",
    )
      .bind(c.get("tenant"), c.req.param("id"), version)
      .run();
    if (!result.meta.changes)
      return fail("La automatización cambió o ya no existe.", 409);
    return c.json({ ok: true });
  });
  app.get("/api/automation-runs", async (c) => {
    const page = pageNumber(c.req.query("page")),
      db = c.env.DB,
      tenant = c.get("tenant");
    const { results } = await db
      .prepare(
        "SELECT * FROM crm_automation_runs WHERE tenant_id=? ORDER BY created_at DESC,id LIMIT ? OFFSET ?",
      )
      .bind(tenant, pageSize, (page - 1) * pageSize)
      .all<any>();
    const total = await db
      .prepare(
        "SELECT count(*) AS total FROM crm_automation_runs WHERE tenant_id=?",
      )
      .bind(tenant)
      .first<{ total: number }>();
    return c.json({
      data: results.map((row) => ({ ...row, detail: JSON.parse(row.detail) })),
      total: total?.total ?? 0,
    });
  });
  app.post("/api/automation-runs/:id/retry", async (c) => {
    const db = c.env.DB,
      tenant = c.get("tenant");
    const row = await db
      .prepare("SELECT * FROM crm_automation_runs WHERE tenant_id=? AND id=?")
      .bind(tenant, c.req.param("id"))
      .first<any>();
    if (!row) return fail("La ejecución no existe.", 404);
    if (row.status === "success") return c.json({ ok: true });
    const detail = JSON.parse(row.detail);
    if (!detail.after)
      return fail("Esta ejecución no contiene un evento recuperable.", 422);
    const current = await getRecord(db, tenant, row.object_name, row.record_id);
    if (current._version !== detail.after._version)
      return fail(
        "El registro cambió desde el error; revisa la regla y actualiza el registro para generar un nuevo evento.",
        409,
      );
    const rule = await db
      .prepare(
        "SELECT version,enabled FROM crm_automations WHERE tenant_id=? AND id=?",
      )
      .bind(tenant, row.automation_id)
      .first<{ version: number; enabled: number }>();
    if (
      !rule ||
      !rule.enabled ||
      String(rule.version) !== String(row.event_key).split(":").at(-1)
    )
      return fail(
        "La regla cambió o está pausada. Revisa la configuración antes de generar un nuevo evento.",
        409,
      );
    await runAutomations(
      db,
      tenant,
      row.object_name,
      detail.before,
      detail.after,
      { ruleId: row.automation_id },
    );
    return c.json({ ok: true });
  });
  app.get("/api/tasks", async (c) => {
    const db = c.env.DB,
      tenant = c.get("tenant"),
      page = pageNumber(c.req.query("page"));
    let where =
      "tenant_id=? AND EXISTS(SELECT 1 FROM crm_records r WHERE r.tenant_id=crm_tasks.tenant_id AND r.id=crm_tasks.record_id AND r.deleted_at IS NULL)";
    const args: (string | number)[] = [tenant];
    if (c.req.query("object")) {
      where += " AND object_name=?";
      args.push(c.req.query("object")!);
    }
    if (c.req.query("record")) {
      where += " AND record_id=?";
      args.push(c.req.query("record")!);
    }
    if (c.req.query("status") === "overdue") {
      where += " AND status='pending' AND due_at<?";
      args.push(now().slice(0, 10));
    } else if (["pending", "done"].includes(c.req.query("status") ?? "")) {
      where += " AND status=?";
      args.push(c.req.query("status")!);
    }
    const { results } = await db
      .prepare(
        `SELECT * FROM crm_tasks WHERE ${where} ORDER BY status DESC,due_at,id LIMIT ? OFFSET ?`,
      )
      .bind(...args, pageSize, (page - 1) * pageSize)
      .all();
    const total = await db
      .prepare(`SELECT count(*) AS total FROM crm_tasks WHERE ${where}`)
      .bind(...args)
      .first<{ total: number }>();
    const overdue = await db
      .prepare(
        "SELECT count(*) AS total FROM crm_tasks WHERE tenant_id=? AND status='pending' AND due_at<? AND EXISTS(SELECT 1 FROM crm_records r WHERE r.tenant_id=crm_tasks.tenant_id AND r.id=crm_tasks.record_id AND r.deleted_at IS NULL)",
      )
      .bind(tenant, now().slice(0, 10))
      .first<{ total: number }>();
    return c.json({
      data: results,
      total: total?.total ?? 0,
      overdue: overdue?.total ?? 0,
    });
  });
  const taskSchema = z.object({
    title: z.string().trim().min(1).max(200),
    owner: z.string().max(100).default(""),
    due_at: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .refine(
        (v) =>
          !Number.isNaN(Date.parse(v)) &&
          new Date(v).toISOString().slice(0, 10) === v,
        "Fecha inválida",
      ),
    status: z.enum(["pending", "done"]).default("pending"),
  });
  app.post("/api/tasks", async (c) => {
    const body = await c.req.json(),
      input = taskSchema
        .extend({ object_name: identifier, record_id: z.string().min(1) })
        .parse(body),
      db = c.env.DB,
      tenant = c.get("tenant");
    await getRecord(db, tenant, input.object_name, input.record_id);
    const id = crypto.randomUUID();
    await db.batch([
      db
        .prepare(
          "INSERT INTO crm_tasks (id,tenant_id,object_name,record_id,title,owner,due_at,status) VALUES (?,?,?,?,?,?,?,?)",
        )
        .bind(
          id,
          tenant,
          input.object_name,
          input.record_id,
          input.title,
          input.owner,
          input.due_at,
          input.status,
        ),
      audit(db, tenant, "task.created", input.object_name, input.record_id, {
        title: input.title,
        due_at: input.due_at,
      }),
    ]);
    return c.json({ data: { id, ...input, version: 1 } }, 201);
  });
  app.patch("/api/tasks/:id", async (c) => {
    const body = await c.req.json(),
      input = taskSchema.parse(body),
      { version } = versionSchema.parse(body),
      db = c.env.DB,
      tenant = c.get("tenant");
    const row = await db
      .prepare("SELECT * FROM crm_tasks WHERE tenant_id=? AND id=?")
      .bind(tenant, c.req.param("id"))
      .first<any>();
    if (!row) return fail("La tarea no existe.", 404);
    await getRecord(db, tenant, row.object_name, row.record_id);
    const result = await db
      .prepare(
        "UPDATE crm_tasks SET title=?,owner=?,due_at=?,status=?,version=version+1 WHERE tenant_id=? AND id=? AND version=?",
      )
      .bind(
        input.title,
        input.owner,
        input.due_at,
        input.status,
        tenant,
        row.id,
        version,
      )
      .run();
    if (!result.meta.changes)
      return fail("La tarea cambió. Actualiza para continuar.", 409);
    await audit(
      db,
      tenant,
      input.status === "done" ? "task.completed" : "task.updated",
      row.object_name,
      row.record_id,
      input,
    ).run();
    return c.json({ data: { ...row, ...input, version: version + 1 } });
  });
  app.delete("/api/tasks/:id", async (c) => {
    const { version } = versionSchema.parse(await c.req.json());
    const result = await c.env.DB.prepare(
      "DELETE FROM crm_tasks WHERE tenant_id=? AND id=? AND version=?",
    )
      .bind(c.get("tenant"), c.req.param("id"), version)
      .run();
    if (!result.meta.changes)
      return fail("La tarea cambió o ya no existe.", 409);
    return c.json({ ok: true });
  });
  app.get("/api/reports", async (c) => {
    const db = c.env.DB,
      tenant = c.get("tenant");
    const { results } = await db
      .prepare("SELECT * FROM crm_objects WHERE tenant_id=? ORDER BY name")
      .bind(tenant)
      .all<any>();
    const reports = [];
    for (const object of results.map(parseObject)) {
      const pipeline = getPipeline(object);
      if (!pipeline?.field || !object.config.fields[pipeline.field]) continue;
      const stage = `$.${identifier.parse(pipeline.field)}`;
      const amount =
        pipeline.amountField && object.config.fields[pipeline.amountField]
          ? `$.${identifier.parse(pipeline.amountField)}`
          : "$.nonexistent_field";
      const owner =
        pipeline.ownerField && object.config.fields[pipeline.ownerField]
          ? `$.${identifier.parse(pipeline.ownerField)}`
          : "$.nonexistent_field";
      const { results: groups } = await db
        .prepare(
          `SELECT COALESCE(${dialectFor(db).jsonText("data", stage)},'Sin etapa') AS stage,COALESCE(${dialectFor(db).jsonText("data", owner)},'Sin responsable') AS owner,count(*) AS count,COALESCE(SUM(CAST(${dialectFor(db).jsonValue("data", amount)} AS DOUBLE PRECISION)),0) AS amount FROM crm_records WHERE tenant_id=? AND object_name=? AND deleted_at IS NULL GROUP BY 1,2 ORDER BY 1,2`,
        )
        .bind(tenant, object.name)
        .all<{ stage: string; owner: string; count: number; amount: number }>();
      const won = groups
          .filter((g) =>
            (pipeline.wonValues ?? []).map(String).includes(g.stage),
          )
          .reduce((n, g) => n + g.count, 0),
        lost = groups
          .filter((g) =>
            (pipeline.lostValues ?? []).map(String).includes(g.stage),
          )
          .reduce((n, g) => n + g.count, 0);
      reports.push({
        object: object.name,
        label: object.label,
        groups,
        total: groups.reduce((n, g) => n + g.count, 0),
        amount: groups.reduce((n, g) => n + g.amount, 0),
        won,
        lost,
        conversion: won + lost ? won / (won + lost) : null,
        configured: {
          field: pipeline.field,
          amountField: pipeline.amountField,
          ownerField: pipeline.ownerField,
        },
      });
    }
    return c.json({ data: reports, generatedAt: now() });
  });
}
