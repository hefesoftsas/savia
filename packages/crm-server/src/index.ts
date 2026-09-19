import { registerOfficeFiles } from "./office-files";
import { Hono } from "hono";
import { registerLocalSync } from "./local-sync";
import { HTTPException } from "hono/http-exception";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { type Env, fail } from "./context";
import {
  getObject,
  getRecord,
  createRecord,
  updateRecord,
  deleteRecord,
  restoreRecord,
  parseObject,
  parseRecord,
  audit,
} from "./services";
import {
  createObject,
  deleteObject,
  patchScreenMeta,
  previewSchema,
  publishSchema,
  screenMetaPatchSchema,
} from "./schema";
import { reconcileStoredMenuLayout } from "./menu-layout";
import { buildWhere, filterSchema } from "./query";
import { seedObjects, seedRecords } from "@savia/crm-shared/seed";
import { type CrmObject, getPipeline } from "@savia/crm-shared/metadata";
import { registerIntegrations } from "./integrations";
import { registerGeocoding } from "./geocoding";
import { registerGeocodingSettings } from "./geocoding-settings";
import { registerMenuLayout } from "./menu-layout";
import { registerOperations, runAutomations } from "./operations";
import {
  registerSolutions,
  disabledSolutionObjects,
  type SolutionOptions,
} from "./solutions";
import { registerExtensions, type ExtensionOptions } from "./extensions";
import { registerExtensionActions } from "./extension-actions";
import { registerExtensionSummaries } from "./extension-summaries";
export function createCrmApp(
  agencyTenant?: string,
  options?: {
    seedObjects?: CrmObject[];
    principalId?: string;
  } & SolutionOptions &
    ExtensionOptions,
) {
  const app = new Hono<Env>();
  app.use(
    "/api/*",
    bodyLimit({
      maxSize: 6 * 1024 * 1024,
      onError: (c) => c.json({ error: "Máximo 6 MB por solicitud." }, 413),
    }),
  );
  app.use("/api/*", async (c, next) => {
    c.set(
      "principalId",
      options?.principalId ?? (agencyTenant ? "" : "local-demo"),
    );
    if (agencyTenant) {
      c.set("tenant", agencyTenant);
      return next();
    }
    if (c.env.POC_LOCAL !== "true")
      return c.json(
        { error: "La ejecución está limitada al entorno local." },
        403,
      );
    if (
      !["localhost", "127.0.0.1", "[::1]"].includes(new URL(c.req.url).hostname)
    )
      return c.json({ error: "Acceso limitado a localhost." }, 403);
    c.set("tenant", "demo");
    await next();
  });
  app.onError((error, c) => {
    if (error instanceof z.ZodError)
      return c.json(
        { error: error.issues.map((i) => i.message).join(" ") },
        422,
      );
    if (error instanceof HTTPException)
      return c.json({ error: error.message }, error.status);
    if (error instanceof SyntaxError)
      return c.json({ error: "El contenido JSON no es válido." }, 422);
    console.error(error);
    return c.json(
      {
        error:
          "No se pudo completar la operación. Reintenta o revisa el historial.",
      },
      500,
    );
  });
  app.use("/api/*", async (c, next) => {
    const match =
      /^\/api\/(?:objects|records|views|notes|files|record-detail|exports)\/([^/]+)/.exec(
        c.req.path,
      );
    if (
      match &&
      (await disabledSolutionObjects(c.env.DB, c.get("tenant"))).has(
        decodeURIComponent(match[1]),
      )
    )
      return c.json(
        { error: "El paquete de esta colección está desactivado." },
        404,
      );
    await next();
  });
  registerExtensions(app, options);
  registerExtensionActions(app, options);
  registerExtensionSummaries(app, options);
  registerSolutions(app, options);
  app.get("/api/health", async (c) => {
    await c.env.DB.prepare("SELECT 1").first();
    return c.json({
      ok: true,
      storage: "D1 + R2",
      mode: agencyTenant ? "savia" : "local",
      version: "0.2",
    });
  });
  app.post("/api/bootstrap", async (c) => {
    const db = c.env.DB,
      tenant = c.get("tenant");
    const exists = await db
      .prepare("SELECT name FROM crm_objects WHERE tenant_id=? LIMIT 1")
      .bind(tenant)
      .first();
    const initialObjects =
      options?.seedObjects ?? (agencyTenant ? [] : seedObjects);
    if (!exists && initialObjects.length)
      await db.batch([
        ...initialObjects.map((o) =>
          db
            .prepare(
              "INSERT OR IGNORE INTO crm_objects(tenant_id,name,label,description,config) VALUES (?,?,?,?,?)",
            )
            .bind(
              tenant,
              o.name,
              o.label,
              o.description,
              JSON.stringify(o.config),
            ),
        ),
        ...(agencyTenant ? [] : seedRecords).map((r) =>
          db
            .prepare(
              "INSERT OR IGNORE INTO crm_records(id,tenant_id,object_name,data) VALUES (?,?,?,?)",
            )
            .bind(r.id, tenant, r.object, JSON.stringify(r.data)),
        ),
      ]);
    await db
      .prepare(
        "INSERT OR IGNORE INTO crm_schema_versions(tenant_id,object_name,version,definition) SELECT tenant_id,name,version,json_object('name',name,'label',label,'description',description,'config',json(config),'version',version) FROM crm_objects WHERE tenant_id=?",
      )
      .bind(tenant)
      .run();
    return c.json({ ok: true });
  });
  app.get("/api/objects", async (c) => {
    const disabled = await disabledSolutionObjects(c.env.DB, c.get("tenant"));
    const { results } = await c.env.DB.prepare(
      "SELECT o.*,(SELECT count(*) FROM crm_records r WHERE r.tenant_id=o.tenant_id AND r.object_name=o.name AND deleted_at IS NULL) AS count FROM crm_objects o WHERE tenant_id=? ORDER BY created_at,name",
    )
      .bind(c.get("tenant"))
      .all();
    const data = results
      .map(parseObject)
      .filter((object) => !disabled.has(object.name))
      .sort((left, right) => {
        const leftOrder = left.config.studio?.screen?.order;
        const rightOrder = right.config.studio?.screen?.order;
        if (leftOrder != null || rightOrder != null) {
          if (leftOrder == null) return 1;
          if (rightOrder == null) return -1;
          if (leftOrder !== rightOrder) return leftOrder - rightOrder;
        }
        return left.label.localeCompare(right.label, "es");
      });
    const menuLayout = await reconcileStoredMenuLayout(
      c.env.DB,
      c.get("tenant"),
    );
    return c.json({ data, menuLayout });
  });
  app.post("/api/objects", async (c) =>
    c.json(
      {
        data: await createObject(c.env.DB, c.get("tenant"), await c.req.json()),
      },
      201,
    ),
  );
  registerMenuLayout(app);
  app.get("/api/objects/:name/versions", async (c) => {
    await getObject(c.env.DB, c.get("tenant"), c.req.param("name"));
    const { results } = await c.env.DB.prepare(
      "SELECT * FROM crm_schema_versions WHERE tenant_id=? AND object_name=? ORDER BY version DESC",
    )
      .bind(c.get("tenant"), c.req.param("name"))
      .all<any>();
    return c.json({
      data: results.map((row) => ({
        ...JSON.parse(row.definition),
        created_at: row.created_at,
      })),
    });
  });
  app.post("/api/objects/:name/preview", async (c) => {
    const body = await c.req.json();
    const preview = await previewSchema(
      c.env.DB,
      c.get("tenant"),
      c.req.param("name"),
      body.object,
      body.migration,
    );
    return c.json({
      data: {
        valid: preview.valid,
        changed: preview.changed,
        total: preview.total,
        errors: preview.errors.slice(0, 100),
      },
    });
  });
  app.put("/api/objects/:name", async (c) => {
    const body = await c.req.json();
    return c.json({
      data: await publishSchema(
        c.env.DB,
        c.get("tenant"),
        c.req.param("name"),
        body,
        body.migration,
      ),
    });
  });
  app.patch("/api/objects/:name/screen", async (c) => {
    const body = screenMetaPatchSchema.parse(await c.req.json());
    const { version, ...screen } = body;
    return c.json({
      data: await patchScreenMeta(
        c.env.DB,
        c.get("tenant"),
        c.req.param("name"),
        screen,
        version,
      ),
    });
  });
  app.delete("/api/objects/:name", async (c) => {
    const parsed = z
      .object({ deleteRecords: z.boolean().optional() })
      .safeParse(await c.req.json().catch(() => ({})));
    const body = parsed.success ? parsed.data : {};
    return c.json({
      data: await deleteObject(
        c.env.DB,
        c.get("tenant"),
        c.req.param("name"),
        body,
      ),
    });
  });
  app.post("/api/objects/:name/restore", async (c) => {
    const body = z
      .object({
        version: z.number().int().positive(),
        targetVersion: z.number().int().positive(),
      })
      .parse(await c.req.json());
    const row = await c.env.DB.prepare(
      "SELECT definition FROM crm_schema_versions WHERE tenant_id=? AND object_name=? AND version=?",
    )
      .bind(c.get("tenant"), c.req.param("name"), body.targetVersion)
      .first<{ definition: string }>();
    if (!row) return fail("Versión de estructura no encontrada.", 404);
    return c.json({
      data: await publishSchema(
        c.env.DB,
        c.get("tenant"),
        c.req.param("name"),
        { ...JSON.parse(row.definition), version: body.version },
        {},
        body.targetVersion,
      ),
    });
  });
  app.get("/api/records/:object", async (c) => {
    const object = await getObject(
        c.env.DB,
        c.get("tenant"),
        c.req.param("object"),
      ),
      params = c.req.query();
    const page = Math.max(1, Math.floor(Number(params.page) || 1)),
      perPage = Math.min(
        200,
        Math.max(1, Math.floor(Number(params.perPage) || 25)),
      );
    const sort = params.sort ?? "updated_at",
      order = params.order === "ASC" ? "ASC" : "DESC";
    if (
      !["created_at", "updated_at", "id"].includes(sort) &&
      !object.config.fields[sort]
    )
      return fail("Campo de orden inválido.");
    const sortSql = ["created_at", "updated_at", "id"].includes(sort)
      ? sort
      : `json_extract(data,'$.${sort}')`;
    const { where, args } = buildWhere(object, c.get("tenant"), params);
    // One D1 batch keeps the count and page in the same transaction and avoids
    // a separate network roundtrip before fetching the visible records.
    const [countResult, pageResult] = await c.env.DB.batch([
      c.env.DB.prepare(
        `SELECT count(*) AS total FROM crm_records WHERE ${where}`,
      ).bind(...args),
      c.env.DB.prepare(
        `SELECT * FROM crm_records WHERE ${where} ORDER BY ${sortSql} ${order},id ASC LIMIT ? OFFSET ?`,
      ).bind(...args, perPage, (page - 1) * perPage),
    ]);
    return c.json({
      data: pageResult.results.map(parseRecord),
      total:
        (countResult.results[0] as { total: number } | undefined)?.total ?? 0,
      page,
      perPage,
    });
  });
  app.get("/api/records/:object/summary", async (c) => {
    const object = await getObject(
        c.env.DB,
        c.get("tenant"),
        c.req.param("object"),
      ),
      params = c.req.query(),
      pipeline = getPipeline(object);
    const group = params.group ?? pipeline?.field;
    if (!group || !object.config.fields[group])
      return fail("Campo de agrupación inválido.", 422);
    const isNumericAmount = (fieldName: string | undefined) => {
      if (!fieldName) return false;
      const type = object.config.fields[fieldName]?.type;
      return type === "Number" || type === "Currency";
    };
    const targetAmountField =
      params.amountField && isNumericAmount(params.amountField)
        ? params.amountField
        : pipeline?.amountField;
    const amount =
      targetAmountField && isNumericAmount(targetAmountField)
        ? `CAST(json_extract(data,'$.${targetAmountField}') AS REAL)`
        : "0";
    const { where, args } = buildWhere(object, c.get("tenant"), params);
    const { results } = await c.env.DB.prepare(
      `SELECT json_extract(data,'$.${group}') AS value,count(*) AS count,COALESCE(sum(${amount}),0) AS amount FROM crm_records WHERE ${where} GROUP BY value ORDER BY count DESC`,
    )
      .bind(...args)
      .all();
    return c.json({ data: results });
  });
  app.get("/api/records/:object/:id", async (c) =>
    c.json({
      data: await getRecord(
        c.env.DB,
        c.get("tenant"),
        c.req.param("object"),
        c.req.param("id"),
      ),
    }),
  );
  async function trigger(
    db: D1Database,
    tenant: string,
    object: string,
    before: any,
    after: any,
  ) {
    try {
      await runAutomations(db, tenant, object, before, after);
    } catch (error) {
      await audit(
        db,
        tenant,
        "automation.failed",
        object,
        after?.id ?? before?.id ?? null,
        { error: (error as Error).message },
      ).run();
    }
  }
  app.post("/api/records/:object", async (c) => {
    const input = z.record(z.string(), z.unknown()).parse(await c.req.json()),
      record = await createRecord(
        c.env.DB,
        c.get("tenant"),
        c.req.param("object"),
        input,
        { idempotencyKey: c.req.header("Idempotency-Key") },
      );
    await trigger(
      c.env.DB,
      c.get("tenant"),
      c.req.param("object"),
      null,
      record,
    );
    return c.json({ data: record }, 201);
  });
  app.patch("/api/records/:object/:id", async (c) => {
    const { _version, ...input } = z
      .record(z.string(), z.unknown())
      .parse(await c.req.json());
    const before = await getRecord(
      c.env.DB,
      c.get("tenant"),
      c.req.param("object"),
      c.req.param("id"),
    );
    const record = await updateRecord(
      c.env.DB,
      c.get("tenant"),
      c.req.param("object"),
      c.req.param("id"),
      input,
      { version: Number(_version) },
    );
    await trigger(
      c.env.DB,
      c.get("tenant"),
      c.req.param("object"),
      before,
      record,
    );
    return c.json({ data: record });
  });
  app.delete("/api/records/:object/:id", async (c) =>
    c.json({
      data: await deleteRecord(
        c.env.DB,
        c.get("tenant"),
        c.req.param("object"),
        c.req.param("id"),
        { version: Number(c.req.query("version")) },
      ),
    }),
  );
  app.post("/api/records/:object/:id/restore", async (c) => {
    const body = z
      .object({ version: z.number().int().positive() })
      .parse(await c.req.json());
    return c.json({
      data: await restoreRecord(
        c.env.DB,
        c.get("tenant"),
        c.req.param("object"),
        c.req.param("id"),
        body.version,
      ),
    });
  });
  app.post("/api/records/:object/bulk", async (c) => {
    const input = z
      .object({
        action: z.enum(["update", "delete", "restore"]),
        records: z
          .array(
            z.object({ id: z.string(), version: z.number().int().positive() }),
          )
          .min(1)
          .max(200),
        data: z.record(z.string(), z.unknown()).optional(),
      })
      .parse(await c.req.json());
    const outcomes = [];
    for (const row of input.records) {
      try {
        if (input.action === "delete")
          await deleteRecord(
            c.env.DB,
            c.get("tenant"),
            c.req.param("object"),
            row.id,
            { version: row.version },
          );
        else if (input.action === "restore")
          await restoreRecord(
            c.env.DB,
            c.get("tenant"),
            c.req.param("object"),
            row.id,
            row.version,
          );
        else {
          const before = await getRecord(
            c.env.DB,
            c.get("tenant"),
            c.req.param("object"),
            row.id,
          );
          const after = await updateRecord(
            c.env.DB,
            c.get("tenant"),
            c.req.param("object"),
            row.id,
            input.data ?? {},
            { version: row.version },
          );
          await trigger(
            c.env.DB,
            c.get("tenant"),
            c.req.param("object"),
            before,
            after,
          );
        }
        outcomes.push({ id: row.id, ok: true });
      } catch (e) {
        outcomes.push({ id: row.id, ok: false, error: (e as Error).message });
      }
    }
    return c.json({ data: outcomes });
  });
  const DEFAULT_TABLE_VIEW_NAME = "__table_default__";
  const tablePreferencesSchema = z.object({
    columns: z.array(z.string()).max(100).optional(),
    columnOrder: z.array(z.string()).max(100).optional(),
    columnAliases: z.record(z.string(), z.string().max(100)).optional(),
  });
  const viewSchema = z.object({
    name: z.string().min(1).max(80),
    config: z.object({
      q: z.string().max(200).default(""),
      stage: z.string().max(200).default(""),
      filters: filterSchema.optional(),
      columns: tablePreferencesSchema.shape.columns,
      columnOrder: tablePreferencesSchema.shape.columnOrder,
      columnAliases: tablePreferencesSchema.shape.columnAliases,
      sort: z
        .object({ field: z.string(), order: z.enum(["ASC", "DESC"]) })
        .optional(),
      group: z.string().optional(),
      mode: z.enum(["table", "pipeline"]).optional(),
      perPage: z.number().int().min(1).max(200).optional(),
    }),
  });
  const validatesTableFields = (
    config: z.infer<typeof tablePreferencesSchema>,
    object: CrmObject,
  ) =>
    [
      ...(config.columns ?? []),
      ...(config.columnOrder ?? []),
      ...Object.keys(config.columnAliases ?? {}),
    ].some((key) => !object.config.fields[key]);
  app.get("/api/views/:object", async (c) => {
    const { results } = await c.env.DB.prepare(
      "SELECT * FROM crm_views WHERE tenant_id=? AND object_name=? ORDER BY name",
    )
      .bind(c.get("tenant"), c.req.param("object"))
      .all<any>();
    const parsed = results.map((row) => ({
      ...row,
      config: JSON.parse(row.config),
    }));
    const defaultView = parsed.find(
      (row) => row.name === DEFAULT_TABLE_VIEW_NAME,
    );
    return c.json({
      data: parsed.filter((row) => row.name !== DEFAULT_TABLE_VIEW_NAME),
      default: defaultView ? { config: defaultView.config } : null,
    });
  });
  app.post("/api/views/:object", async (c) => {
    const input = viewSchema.parse(await c.req.json()),
      object = await getObject(
        c.env.DB,
        c.get("tenant"),
        c.req.param("object"),
      );
    if (input.name === DEFAULT_TABLE_VIEW_NAME)
      return fail(
        "Ese nombre está reservado para la configuración de tabla.",
        422,
      );
    if (validatesTableFields(input.config, object))
      return fail("La vista incluye un campo inexistente.", 422);
    const id = crypto.randomUUID();
    await c.env.DB.prepare(
      "INSERT INTO crm_views(id,tenant_id,object_name,name,config) VALUES (?,?,?,?,?)",
    )
      .bind(
        id,
        c.get("tenant"),
        object.name,
        input.name,
        JSON.stringify(input.config),
      )
      .run();
    return c.json({ data: { id, ...input } }, 201);
  });
  app.put("/api/views/:object/default", async (c) => {
    const input = z
        .object({ config: tablePreferencesSchema })
        .parse(await c.req.json()),
      object = await getObject(
        c.env.DB,
        c.get("tenant"),
        c.req.param("object"),
      );
    if (validatesTableFields(input.config, object))
      return fail("La vista incluye un campo inexistente.", 422);
    const existing = await c.env.DB.prepare(
      "SELECT id FROM crm_views WHERE tenant_id=? AND object_name=? AND name=? LIMIT 1",
    )
      .bind(c.get("tenant"), object.name, DEFAULT_TABLE_VIEW_NAME)
      .first<{ id: string }>();
    const config = JSON.stringify(input.config);
    if (existing)
      await c.env.DB.prepare("UPDATE crm_views SET config=? WHERE id=?")
        .bind(config, existing.id)
        .run();
    else
      await c.env.DB.prepare(
        "INSERT INTO crm_views(id,tenant_id,object_name,name,config) VALUES (?,?,?,?,?)",
      )
        .bind(
          crypto.randomUUID(),
          c.get("tenant"),
          object.name,
          DEFAULT_TABLE_VIEW_NAME,
          config,
        )
        .run();
    return c.json({ data: { config: input.config } });
  });
  app.delete("/api/views/:object/:id", async (c) => {
    await c.env.DB.prepare(
      "DELETE FROM crm_views WHERE tenant_id=? AND object_name=? AND id=?",
    )
      .bind(c.get("tenant"), c.req.param("object"), c.req.param("id"))
      .run();
    return c.json({ ok: true });
  });
  app.get("/api/audit", async (c) => {
    const { results } = await c.env.DB.prepare(
      "SELECT id,action,object_name,record_id,created_at,detail FROM crm_audit WHERE tenant_id=? AND (? IS NULL OR object_name=?) ORDER BY created_at DESC LIMIT 100",
    )
      .bind(
        c.get("tenant"),
        c.req.query("object") ?? null,
        c.req.query("object") ?? null,
      )
      .all<any>();
    return c.json({
      data: results.map((row) => ({ ...row, detail: JSON.parse(row.detail) })),
    });
  });
  app.post("/api/demo/quotes", async (c) => {
    const input = z
      .object({
        name: z.string().min(1),
        email: z.string().email().optional().or(z.literal("")).nullable(),
        seats: z.number().int().min(1).max(10000),
        plan: z.enum(["Esencial", "Profesional"]).optional().nullable(),
      })
      .parse(await c.req.json());
    const result = {
      quoteId: crypto.randomUUID(),
      project: input.name,
      currency: "COP",
      monthlyTotal:
        input.seats * (input.plan === "Profesional" ? 89000 : 49000),
      seats: input.seats,
      plan: input.plan ?? "Esencial",
      demo: true,
    };
    await audit(
      c.env.DB,
      c.get("tenant"),
      "integration.executed",
      "quote",
      result.quoteId,
      { input, result },
    ).run();
    return c.json(result);
  });
  registerIntegrations(app);
  registerGeocoding(app);
  registerGeocodingSettings(app);
  registerLocalSync(app, trigger);
  registerOfficeFiles(app);
  registerOperations(app);
  return app;
}
export default createCrmApp();
