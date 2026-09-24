import { dialectFor } from "@savia/db/dialect";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "@hono/zod-openapi";
import type {
  RelationDefinition,
  RecordRelationGroup,
} from "@savia/studio-shared/relations";

type RelationObject = {
  name: string;
  label: string;
  config: Record<string, any>;
  source?: any;
};
export interface NativeRelationProvider {
  definitions(
    object: (name: string) => Promise<RelationObject>,
  ): Promise<RelationDefinition[]>;
  readIds(query: {
    definition: RelationDefinition;
    direction: "outgoing" | "incoming";
    id: string;
    page: number;
    perPage: number;
    includeRecords: boolean;
  }): Promise<{ ids: string[]; total: number }>;
  supportsFieldQuery?(object: RelationObject): boolean;
}

type Dependencies = {
  nativeRelations?: NativeRelationProvider;
  db: D1Database;
  tenant: string;
  readRecord: (object: string, id: string) => Promise<Record<string, unknown>>;
  listRecords?: (object: string, query: Record<string, string>) => Promise<any>;
};
const fieldName = z
  .string()
  .regex(/^[A-Za-z_][A-Za-z0-9_]*$/)
  .max(120);
const inputSchema = z.object({
  sourceField: fieldName.default("id"),
  targetField: fieldName.default("id"),
  sourceDisplayField: fieldName.nullish(),
  targetDisplayField: fieldName.nullish(),
  storage: z.enum(["local", "fields", "native"]).default("local"),
  sourceObject: z.string().min(1).max(48),
  targetObject: z.string().min(1).max(48),
  sourceLabel: z.string().trim().min(1).max(120),
  targetLabel: z.string().trim().min(1).max(120),
  cardinality: z.enum(["one-to-one", "one-to-many", "many-to-many"]),
});
function fail(message: string, status: 403 | 404 | 409 | 422 = 422): never {
  throw new HTTPException(status, { message });
}
export const handlesCollectionRelationsPath = (path: string) =>
  /^\/api\/(?:collection-relations(?:\/[^/]+)?|record-links\/[^/]+\/[^/]+(?:\/[^/]+)?)\/?$/.test(
    path,
  );
const title = (record: Record<string, unknown>, id: string) => {
  for (const key of [
    "name",
    "label",
    "title",
    "nombre",
    "full_name",
    "legal_name",
    "business_name",
    "display_name",
    "client_name",
    "agency_name",
  ])
    if (typeof record[key] === "string" && record[key])
      return String(record[key]);
  const readable = Object.entries(record).find(
    ([key, value]) =>
      !/^(id|.*_id|created_at|updated_at)$/.test(key) &&
      typeof value === "string" &&
      value.trim(),
  );
  return readable ? String(readable[1]) : id;
};
const columns = (target: { config: Record<string, any> }) => {
  const fields = target.config.fields ?? {};
  const order = Array.isArray(target.config.fieldOrder)
    ? target.config.fieldOrder
    : Object.keys(fields);
  return order
    .filter((key): key is string => {
      const field = fields[key];
      return Boolean(
        field &&
        field.hidden !== true &&
        field.type !== "Textarea" &&
        field.type !== "R2Attachment",
      );
    })
    .map((key) => ({ key, label: String(fields[key].label ?? key) }));
};
export function createCollectionRelationsApp({
  db,
  tenant,
  readRecord,
  nativeRelations,
}: Dependencies) {
  const app = new Hono();
  app.onError((error, c) =>
    error instanceof HTTPException
      ? c.json({ error: error.message }, error.status)
      : c.json({ error: "No se pudo procesar la relación." }, 500),
  );
  async function object(name: string) {
    const row = await db
      .prepare(
        "SELECT name,label,config FROM studio_objects WHERE tenant_id=? AND name=?",
      )
      .bind(tenant, name)
      .first<{ name: string; label: string; config: string }>();
    if (!row) fail("Colección no encontrada.", 404);
    const config = JSON.parse(row.config);
    const binding = await db
      .prepare(
        "SELECT config FROM crm_collection_bindings WHERE tenant_id=? AND object_name=?",
      )
      .bind(tenant, name)
      .first<{ config: string }>();
    const source = binding
      ? JSON.parse(binding.config)
      : config.studio?.collection;
    if (
      source?.capabilities?.read === false ||
      config.studio?.capabilities?.read === false
    )
      fail("La colección no permite lectura.", 403);
    return { ...row, config, source };
  }
  async function definitions(): Promise<RelationDefinition[]> {
    const rows = await db
      .prepare(
        'SELECT id,source_object AS "sourceObject",target_object AS "targetObject",source_label AS "sourceLabel",target_label AS "targetLabel",cardinality,source_field AS "sourceField",target_field AS "targetField",source_display_field AS "sourceDisplayField",target_display_field AS "targetDisplayField",storage,version FROM studio_collection_relations WHERE tenant_id=? ORDER BY id LIMIT 501',
      )
      .bind(tenant)
      .all<RelationDefinition>();
    const result: RelationDefinition[] = [];
    for (const row of rows.results) {
      if (row.storage === "native") continue;
      try {
        await object(row.sourceObject);
        await object(row.targetObject);
        result.push(row);
      } catch (e) {
        if (!(e instanceof HTTPException && [403, 404].includes(e.status)))
          throw e;
      }
    }
    if (nativeRelations)
      result.push(...(await nativeRelations.definitions(object)));
    return result;
  }
  async function validate(value: z.infer<typeof inputSchema>, native = false) {
    const a = await object(value.sourceObject),
      b = await object(value.targetObject);
    function field(o: typeof a, name: string) {
      if (name === "id") return { type: "Textbox", unique: true };
      const f = o.config.fields?.[name];
      if (!f) fail(`El campo ${o.name}.${name} no existe.`);
      return f;
    }
    for (const [o, name] of [
      [a, value.sourceDisplayField],
      [b, value.targetDisplayField],
    ] as const)
      if (name) field(o, name);
    if (native) return;
    const af = field(a, value.sourceField),
      bf = field(b, value.targetField);
    if (value.storage === "native")
      fail(
        "Las relaciones nativas se gestionan desde su definición existente.",
      );
    if (value.storage === "local") {
      if (value.sourceField !== "id" || value.targetField !== "id")
        fail(
          "Las asociaciones manuales usan id. Selecciona relación por campos para otra clave.",
        );
      return;
    }
    if (
      (a.source && a.source.kind !== "local") ||
      (b.source && b.source.kind !== "local") ||
      [a, b].some((o) => nativeRelations?.supportsFieldQuery?.(o) === false)
    )
      fail(
        "Este origen no admite consultas por campos; edita la relación nativa disponible o usa asociaciones manuales.",
      );
    if (
      [af, bf].some(
        (f) => f.config?.multiple || f.config?.relation || f.config?.formula,
      )
    )
      fail(
        "Los campos calculados, múltiples o de relación no admiten esta conexión.",
      );
    const family = (type: string) =>
      [
        "Textbox",
        "Textarea",
        "Email",
        "Phone",
        "URL",
        "Select",
        "Dropdown",
        "DateControl",
        "Date",
        "DateTime",
      ].includes(type)
        ? "string"
        : ["Number", "Currency", "Percent", "Integer", "Decimal"].includes(type)
          ? "number"
          : type;
    if (
      !["string", "number", "Checkbox", "Boolean", "Toggle"].includes(
        family(af.type),
      ) ||
      family(af.type) !== family(bf.type)
    )
      fail("Los campos deben tener tipos escalares compatibles.");
    if (
      value.cardinality !== "many-to-many" &&
      value.sourceField !== "id" &&
      af.unique !== true &&
      af.config?.unique !== true
    )
      fail("El campo de origen del lado uno debe ser único.");
    if (
      value.cardinality === "one-to-one" &&
      value.targetField !== "id" &&
      bf.unique !== true &&
      bf.config?.unique !== true
    )
      fail("El campo de destino del lado uno debe ser único.");
  }
  app.put("/api/collection-relations/:id", async (c) => {
    const old = (await definitions()).find((r) => r.id === c.req.param("id"));
    if (!old) fail("Relación no encontrada.", 404);
    const body = await c.req.json().catch(() => null);
    if (!Number.isSafeInteger(body?.version) || body.version !== old.version)
      fail("La relación cambió. Recarga antes de guardar.", 409);
    const parsed = inputSchema.safeParse({ ...old, ...body });
    if (!parsed.success) fail("Definición de relación inválida.");
    const value = parsed.data;
    if (
      value.sourceObject !== old.sourceObject ||
      value.targetObject !== old.targetObject
    )
      fail("No se pueden cambiar las colecciones de una relación existente.");
    if (old.storage === "native") {
      if (
        value.storage !== "native" ||
        value.sourceField !== old.sourceField ||
        value.targetField !== old.targetField ||
        value.cardinality !== old.cardinality
      )
        fail("El origen fija los campos de conexión y su cardinalidad.");
      await validate(value, true);
      const config = JSON.stringify({
        sourceLabel: value.sourceLabel,
        targetLabel: value.targetLabel,
        sourceDisplayField: value.sourceDisplayField ?? null,
        targetDisplayField: value.targetDisplayField ?? null,
      });
      const result = await db
        .prepare(
          "INSERT INTO studio_native_relation_overrides(tenant_id,id,config,version) VALUES(?,?,?,2) ON CONFLICT(tenant_id,id) DO UPDATE SET config=excluded.config,version=studio_native_relation_overrides.version+1 WHERE studio_native_relation_overrides.version=?",
        )
        .bind(tenant, old.id, config, body.version)
        .run();
      if (!result.meta.changes)
        fail("La relación cambió. Recarga antes de guardar.", 409);
    } else {
      await validate(value);
      try {
        const result = await db
          .prepare(
            "UPDATE studio_collection_relations SET source_label=?,target_label=?,cardinality=?,source_field=?,target_field=?,source_display_field=?,target_display_field=?,storage=?,version=version+1 WHERE tenant_id=? AND id=? AND version=?",
          )
          .bind(
            value.sourceLabel,
            value.targetLabel,
            value.cardinality,
            value.sourceField,
            value.targetField,
            value.sourceDisplayField ?? null,
            value.targetDisplayField ?? null,
            value.storage,
            tenant,
            old.id,
            body.version,
          )
          .run();
        if (!result.meta.changes)
          fail("La relación cambió. Recarga antes de guardar.", 409);
      } catch (e) {
        if (String(e).includes("relation_mapping_has_links"))
          fail(
            "Desvincula las asociaciones manuales antes de cambiar los campos.",
            409,
          );
        if (String(e).includes("relation_cardinality_conflict"))
          fail(
            "Las conexiones existentes incumplen la cardinalidad seleccionada.",
            409,
          );
        throw e;
      }
    }
    return c.json({
      data: { id: old.id, ...value, version: body.version + 1 },
    });
  });

  app.get("/api/collection-relations", async (c) =>
    c.json({ data: await definitions() }),
  );
  app.post("/api/collection-relations", async (c) => {
    const parsed = inputSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) fail("Definición de relación inválida.");
    const value = parsed.data;
    if (value.sourceObject === value.targetObject)
      fail("Selecciona dos colecciones distintas.");
    await validate(value);
    const count = await db
      .prepare(
        "SELECT COUNT(*) total FROM studio_collection_relations WHERE tenant_id=?",
      )
      .bind(tenant)
      .first<{ total: number }>();
    if ((count?.total ?? 0) >= 500)
      fail("Se alcanzó el límite de relaciones.", 409);
    const id = crypto.randomUUID();
    await db
      .prepare(
        "INSERT INTO studio_collection_relations(tenant_id,id,source_object,target_object,source_label,target_label,cardinality,source_field,target_field,source_display_field,target_display_field,storage) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
      )
      .bind(
        tenant,
        id,
        value.sourceObject,
        value.targetObject,
        value.sourceLabel,
        value.targetLabel,
        value.cardinality,
        value.sourceField,
        value.targetField,
        value.sourceDisplayField ?? null,
        value.targetDisplayField ?? null,
        value.storage,
      )
      .run();
    return c.json({ data: { id, ...value, version: 1 } }, 201);
  });
  app.delete("/api/collection-relations/:id", async (c) => {
    if (c.req.param("id").startsWith("native:"))
      fail("La relación pertenece al origen.", 403);
    const definition = (await definitions()).find(
      (r) => r.id === c.req.param("id"),
    );
    if (!definition) fail("Relación no encontrada.", 404);
    await db
      .prepare(
        "DELETE FROM studio_collection_relations WHERE tenant_id=? AND id=?",
      )
      .bind(tenant, definition.id)
      .run();
    return c.json({ data: { id: definition.id } });
  });
  app.get("/api/record-links/:object/:id", async (c) => {
    const name = c.req.param("object"),
      id = c.req.param("id");
    await object(name);
    const currentRecord = await readRecord(name, id);
    const page = Number(c.req.query("page") ?? 1),
      perPage = Number(c.req.query("perPage") ?? 25);
    const includeRecords = c.req.query("includeRecords") !== "false";
    const includeRecordData = c.req.query("includeRecords") === "true";
    const relationId = c.req.query("relationId");
    const directionFilter = c.req.query("direction");
    if (
      !Number.isSafeInteger(page) ||
      page < 1 ||
      !Number.isSafeInteger(perPage) ||
      perPage < 1 ||
      perPage > 100 ||
      !Number.isSafeInteger((page - 1) * perPage)
    )
      fail("Paginación inválida.");
    const groups: RecordRelationGroup[] = [];
    for (const definition of await definitions())
      for (const direction of ["outgoing", "incoming"] as const) {
        if (relationId && definition.id !== relationId) continue;
        if (directionFilter && directionFilter !== direction) continue;
        if (
          (direction === "outgoing"
            ? definition.sourceObject
            : definition.targetObject) !== name
        )
          continue;
        const targetObject =
          direction === "outgoing"
            ? definition.targetObject
            : definition.sourceObject;
        const target = await object(targetObject);
        let ids: string[] = [],
          total = 0;
        if (definition.storage === "native") {
          if (!nativeRelations) fail("Relación no disponible.", 404);
          ({ ids, total } = await nativeRelations.readIds({
            definition,
            direction,
            id,
            page,
            perPage,
            includeRecords,
          }));
        } else if (definition.storage === "fields") {
          const currentField =
            direction === "outgoing"
              ? definition.sourceField!
              : definition.targetField!;
          const matchField =
            direction === "outgoing"
              ? definition.targetField!
              : definition.sourceField!;
          const value =
            currentField === "id" ? id : currentRecord[currentField];
          if (value !== null && value !== undefined && value !== "") {
            const comparison =
              matchField === "id"
                ? { sql: "id=?", parameters: [value] }
                : dialectFor(db).jsonCompare(
                    "data",
                    `$.${matchField}`,
                    "eq",
                    value,
                  );
            const where = `tenant_id=? AND object_name=? AND deleted_at IS NULL AND ${comparison.sql}`;
            const params = [tenant, targetObject, ...comparison.parameters];
            total =
              (
                await db
                  .prepare(
                    `SELECT count(*) total FROM studio_records WHERE ${where}`,
                  )
                  .bind(...params)
                  .first<{ total: number }>()
              )?.total ?? 0;
            if (includeRecords)
              ids = (
                await db
                  .prepare(
                    `SELECT id FROM studio_records WHERE ${where} ORDER BY id LIMIT ? OFFSET ?`,
                  )
                  .bind(...params, perPage, (page - 1) * perPage)
                  .all<{ id: string }>()
              ).results.map((r) => r.id);
          }
        } else {
          const field = direction === "outgoing" ? "source_id" : "target_id",
            other = direction === "outgoing" ? "target_id" : "source_id";
          total =
            (
              await db
                .prepare(
                  `SELECT count(*) total FROM studio_record_links WHERE tenant_id=? AND relation_id=? AND ${field}=?`,
                )
                .bind(tenant, definition.id, id)
                .first<{ total: number }>()
            )?.total ?? 0;
          if (includeRecords)
            ids = (
              await db
                .prepare(
                  `SELECT ${other} id FROM studio_record_links WHERE tenant_id=? AND relation_id=? AND ${field}=? ORDER BY ${other} LIMIT ? OFFSET ?`,
                )
                .bind(tenant, definition.id, id, perPage, (page - 1) * perPage)
                .all<{ id: string }>()
            ).results.map((r) => r.id);
        }
        const records: RecordRelationGroup["records"] = [];
        for (const targetId of includeRecords ? ids : []) {
          try {
            const record = await readRecord(targetObject, targetId);
            const displayField =
              direction === "outgoing"
                ? definition.targetDisplayField
                : definition.sourceDisplayField;
            records.push({
              id: targetId,
              label:
                displayField && record[displayField] != null
                  ? String(record[displayField])
                  : title(record, targetId),
              ...(includeRecordData ? { data: record } : {}),
            });
          } catch (e) {
            if (!(e instanceof HTTPException && e.status === 404)) throw e;
            if (definition.storage === "local")
              records.push({
                id: targetId,
                label: `Registro no disponible (${targetId})`,
                missing: true,
              });
          }
        }
        groups.push({
          definition,
          direction,
          targetObject,
          targetLabel: target.label,
          label:
            direction === "outgoing"
              ? definition.sourceLabel
              : definition.targetLabel,
          records,
          targetColumns: columns(target),
          total,
          canEdit: definition.storage === "local",
          ...(definition.storage !== "local"
            ? {
                readOnlyReason:
                  "Relación calculada desde campos; se modifica desde los registros de origen.",
              }
            : {}),
          cardinalityConflict:
            total > 1 &&
            (definition.cardinality === "one-to-one" ||
              (direction === "incoming" &&
                definition.cardinality === "one-to-many")),
        });
      }
    return c.json({ data: groups });
  });
  app.on(
    ["POST", "DELETE"],
    "/api/record-links/:object/:id/:relationId",
    async (c) => {
      const name = c.req.param("object"),
        id = c.req.param("id"),
        relationId = c.req.param("relationId");
      const definition = (await definitions()).find((r) => r.id === relationId);
      if (!definition) fail("Relación no encontrada.", 404);
      if (definition.storage !== "local")
        fail("La relación pertenece al origen.", 403);
      if (![definition.sourceObject, definition.targetObject].includes(name))
        fail("Colección ajena a la relación.", 404);
      const body = await c.req.json().catch(() => null);
      if (
        typeof body?.targetId !== "string" ||
        !body.targetId ||
        body.targetId.length > 512
      )
        fail("Registro destino inválido.");
      const outgoing = name === definition.sourceObject;
      await readRecord(name, id);
      try {
        await readRecord(
          outgoing ? definition.targetObject : definition.sourceObject,
          body.targetId,
        );
      } catch (error) {
        // An origin-owned record can disappear; explicit unlink still removes its metadata.
        if (!(
          c.req.method === "DELETE" &&
          error instanceof HTTPException &&
          error.status === 404
        ))
          throw error;
      }
      const sourceId = outgoing ? id : body.targetId,
        targetId = outgoing ? body.targetId : id;
      if (c.req.method === "DELETE")
        await db
          .prepare(
            "DELETE FROM studio_record_links WHERE tenant_id=? AND relation_id=? AND source_id=? AND target_id=?",
          )
          .bind(tenant, relationId, sourceId, targetId)
          .run();
      else
        try {
          await db
            .prepare(
              "INSERT INTO studio_record_links(tenant_id,relation_id,source_id,target_id) VALUES(?,?,?,?) ON CONFLICT DO NOTHING",
            )
            .bind(tenant, relationId, sourceId, targetId)
            .run();
        } catch (e) {
          if (String(e).includes("relation_mapping_has_links"))
            fail(
              "La relación cambió y ya no admite asociaciones manuales.",
              409,
            );
          if (String(e).includes("relation_cardinality_conflict"))
            fail("La cardinalidad no permite esta conexión.", 409);
          throw e;
        }
      return c.json({ data: { sourceId, targetId } });
    },
  );
  return app;
}
