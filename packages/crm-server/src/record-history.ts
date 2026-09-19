import { z } from "zod";
import type { Hono } from "hono";
import type { AccessPredicate } from "@savia/crm-shared/access-control";
import {
  decideRecord,
  matchesPredicate,
} from "@savia/crm-shared/access-evaluator";
import { configSchema } from "@savia/crm-shared/metadata";
import {
  defaultRecordHistorySettings,
  isHistoryField,
  recordHistorySettingsSchema,
  type RecordHistoryEntry,
  type RecordHistoryDetail,
} from "@savia/crm-shared/record-history";
import { type Env, fail } from "./context";
import {
  accessRecord,
  policyFor,
  requireRecordAccess,
} from "./access-authorization";
import {
  assertLocalCollection,
  audit,
  getObject,
  guard,
  parseRecord,
  transaction,
} from "./services";

/** Mutable row predicates cannot authorize historical values without historical context. */
const stablePredicate = (predicate: AccessPredicate): boolean =>
  "all" in predicate
    ? true
    : "and" in predicate
      ? predicate.and.every(stablePredicate)
      : "or" in predicate
        ? predicate.or.every(stablePredicate)
        : predicate.field === "$createdBy";
const settingsFor = (object: Awaited<ReturnType<typeof getObject>>) =>
  recordHistorySettingsSchema.parse(
    object.config.studio?.history ?? defaultRecordHistorySettings,
  );
async function historyAccess(
  db: D1Database,
  tenant: string,
  name: string,
  id: string,
) {
  await assertLocalCollection(db, tenant, name);
  const object = await getObject(db, tenant, name);
  const row = await db
    .prepare(
      "SELECT * FROM crm_records WHERE tenant_id=? AND object_name=? AND id=?",
    )
    .bind(tenant, name, id)
    .first();
  if (!row) return fail("El registro no existe.", 404);
  const record = parseRecord(row);
  requireRecordAccess(db, name, "read", record);
  if (record.deleted_at) requireRecordAccess(db, name, "restore", record);
  const policy = policyFor(db);
  let allowed = Object.keys(object.config.fields).filter((name) =>
    isHistoryField(name, object.config.fields[name]),
  );
  if (policy) {
    const source = accessRecord(record);
    const stable = policy.grants.filter(
      (g) =>
        g.resource === `collection:${name}` &&
        g.action === "read" &&
        stablePredicate(g.predicate) &&
        matchesPredicate(g.predicate, policy, source),
    );
    if (!stable.length)
      return fail(
        "El historial requiere permisos de lectura generales o basados en el creador; los filtros sobre valores actuales no autorizan datos anteriores.",
        403,
      );
    const current = new Set(
      decideRecord(policy, `collection:${name}`, "read", source).fields,
    );
    const historical = new Set(stable.flatMap((g) => g.fields));
    allowed = allowed.filter((f) => current.has(f) && historical.has(f));
  }
  return {
    object,
    settings: settingsFor(object),
    fields: allowed.sort(),
    policy,
  };
}
type Row = {
  version: number;
  action: RecordHistoryEntry["action"];
  created_at: string;
  actor_kind: RecordHistoryEntry["actor"]["kind"];
  actor_id: string | null;
  cause_id: string | null;
  fields_json: string;
  changes?: string;
};
const summary = (row: Row, allowed: Set<string>): RecordHistoryEntry => ({
  version: row.version,
  action: row.action,
  createdAt: row.created_at,
  actor: { kind: row.actor_kind, id: row.actor_id, causeId: row.cause_id },
  fields: (JSON.parse(row.fields_json) as string[])
    .filter((f) => allowed.has(f))
    .sort(),
});
const columns =
  "h.version,h.action,h.created_at,h.actor_kind,h.actor_id,h.cause_id,(SELECT json_group_array(key) FROM json_each(h.changes)) AS fields_json";
const pageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(16384).optional(),
});
const cursorSchema = z
  .object({
    version: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    binding: z.string().max(12000),
  })
  .strict();
const encode = (value: unknown) =>
  btoa(encodeURIComponent(JSON.stringify(value)));
const keySchema = z.string().min(1).max(128);
const idSchema = z.string().min(1).max(256);
const retentionWhere = "h.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')";

export function registerRecordHistory(app: Hono<Env>) {
  app.use("/api/record-history/*", async (c, next) => {
    c.header("cache-control", "no-store");
    await next();
  });
  app.use("/api/record-history-settings/*", async (c, next) => {
    c.header("cache-control", "no-store");
    await next();
  });
  app.get("/api/record-history-settings/:object", async (c) => {
    const db = c.env.DB,
      tenant = c.get("tenant"),
      name = keySchema.parse(c.req.param("object"));
    if (policyFor(db))
      return fail(
        "Solo los administradores de esquema pueden configurar el historial.",
        403,
      );
    await assertLocalCollection(db, tenant, name);
    const object = await getObject(db, tenant, name);
    return c.json({ data: settingsFor(object), version: object.version ?? 1 });
  });
  app.put("/api/record-history-settings/:object", async (c) => {
    const db = c.env.DB,
      tenant = c.get("tenant"),
      name = keySchema.parse(c.req.param("object"));
    if (policyFor(db))
      return fail(
        "Solo los administradores de esquema pueden configurar el historial.",
        403,
      );
    const body = z
      .object({
        enabled: z.unknown(),
        fields: z.unknown(),
        retentionDays: z.unknown(),
        expectedVersion: z.number().int().positive(),
      })
      .strict()
      .parse(await c.req.json());
    const { expectedVersion, ...input } = body;
    const data = recordHistorySettingsSchema.parse(input);
    await assertLocalCollection(db, tenant, name);
    const object = await getObject(db, tenant, name);
    const version = object.version ?? 1;
    if (version !== expectedVersion)
      return fail(
        "La colección cambió. Recarga la configuración antes de guardar.",
        409,
      );
    const config = configSchema.parse({
      ...object.config,
      studio: { ...object.config.studio, history: data },
    });
    const g = guard(
      db,
      "SELECT version=? FROM crm_objects WHERE tenant_id=? AND name=?",
      [version, tenant, name],
    );
    await transaction(db, [
      g.start,
      db
        .prepare(
          "UPDATE crm_objects SET config=?,version=version+1 WHERE tenant_id=? AND name=?",
        )
        .bind(JSON.stringify(config), tenant, name),
      audit(db, tenant, "object.history_configured", name, null, {
        before: settingsFor(object),
        after: data,
      }),
      g.end,
    ]);
    return c.json({ data, version: version + 1 });
  });
  app.get("/api/record-history/:object/:id", async (c) => {
    const db = c.env.DB,
      tenant = c.get("tenant"),
      name = keySchema.parse(c.req.param("object")),
      id = idSchema.parse(c.req.param("id"));
    const { fields, settings, policy } = await historyAccess(
      db,
      tenant,
      name,
      id,
    );
    const q = pageQuery.parse(c.req.query());
    const binding = JSON.stringify([
      tenant,
      name,
      id,
      policy?.principalId ?? c.get("principalId"),
      policy?.revision ?? null,
      fields,
      settings.retentionDays,
    ]);
    let version = Number.MAX_SAFE_INTEGER;
    if (q.cursor) {
      try {
        const decoded = cursorSchema.parse(
          JSON.parse(decodeURIComponent(atob(q.cursor))),
        );
        if (decoded.binding !== binding) throw new Error();
        version = decoded.version;
      } catch {
        return fail(
          "El cursor de historial no es válido para este registro y sus permisos. Actualiza el historial.",
          422,
        );
      }
    }
    const rows = await db
      .prepare(
        `SELECT ${columns} FROM crm_record_history h WHERE h.tenant_id=? AND h.object_name=? AND h.record_id=? AND h.version<? AND ${retentionWhere} ORDER BY h.version DESC LIMIT ?`,
      )
      .bind(tenant, name, id, version, q.limit + 1)
      .all<Row>();
    const page = rows.results.slice(0, q.limit),
      last = page.at(-1),
      allowed = new Set(fields);
    return c.json({
      data: page.map((row) => summary(row, allowed)),
      nextCursor:
        rows.results.length > q.limit && last
          ? encode({ version: last.version, binding })
          : null,
      enabled: settings.enabled,
      retentionDays: settings.retentionDays,
    });
  });
  app.get("/api/record-history/:object/:id/:version", async (c) => {
    const db = c.env.DB,
      tenant = c.get("tenant"),
      name = keySchema.parse(c.req.param("object")),
      id = idSchema.parse(c.req.param("id"));
    const version = z.coerce
      .number()
      .int()
      .positive()
      .max(Number.MAX_SAFE_INTEGER)
      .parse(c.req.param("version"));
    const { fields, settings } = await historyAccess(db, tenant, name, id);
    const row = await db
      .prepare(
        `SELECT ${columns},h.changes FROM crm_record_history h WHERE h.tenant_id=? AND h.object_name=? AND h.record_id=? AND h.version=? AND ${retentionWhere}`,
      )
      .bind(tenant, name, id, version)
      .first<Row>();
    if (!row) return fail("El cambio no existe o ya venció su retención.", 404);
    const allowed = new Set(fields),
      changes = JSON.parse(row.changes!) as RecordHistoryDetail["changes"];
    return c.json({
      data: {
        ...summary(row, allowed),
        changes: Object.fromEntries(
          Object.entries(changes).filter(([field]) => allowed.has(field)),
        ),
      },
    });
  });
}
