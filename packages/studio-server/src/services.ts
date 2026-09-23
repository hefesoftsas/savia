import { dialectFor } from "@savia/db/dialect";
import type { StudioObject, StudioRecord } from "@savia/studio-shared/metadata";
import { validateRecord, fieldEntries } from "@savia/studio-shared/metadata";
import { fail } from "./context";
import { disabledSolutionObjects } from "./solution-state";
import {
  policyFor,
  requireRecordAccess,
  requireWriteAccess,
} from "./access-authorization";
import type { AccessAction } from "@savia/studio-shared/access-control";
export const parseObject = (row: any): StudioObject => ({
  ...row,
  config: JSON.parse(row.config),
});
export const parseRecord = (row: any): StudioRecord => ({
  ...JSON.parse(row.data),
  id: row.id,
  created_at: row.created_at,
  updated_at: row.updated_at,
  _version: row.version,
  deleted_at: row.deleted_at,
  ...(row.created_by ? { created_by: row.created_by } : {}),
});
export async function getObject(db: D1Database, tenant: string, name: string) {
  if ((await disabledSolutionObjects(db, tenant)).has(name))
    return fail("El paquete de esta colección está desactivado.", 404);
  const row = await db
    .prepare("SELECT * FROM studio_objects WHERE tenant_id=? AND name=?")
    .bind(tenant, name)
    .first();
  if (!row) return fail("El objeto no existe.", 404);
  return parseObject(row);
}
export async function getRecord(
  db: D1Database,
  tenant: string,
  object: string,
  id: string,
  action: AccessAction = "read",
) {
  await getObject(db, tenant, object);
  const row = await db
    .prepare(
      "SELECT * FROM studio_records WHERE tenant_id=? AND object_name=? AND id=? AND deleted_at IS NULL",
    )
    .bind(tenant, object, id)
    .first();
  if (!row) return fail("El registro no existe.", 404);
  const record = parseRecord(row);
  requireRecordAccess(db, object, action, record);
  return record;
}
export function audit(
  db: D1Database,
  tenant: string,
  action: string,
  object: string,
  id: string | null,
  detail: unknown,
) {
  return db
    .prepare(
      "INSERT INTO studio_audit(id,tenant_id,action,object_name,record_id,detail) VALUES (?,?,?,?,?,?)",
    )
    .bind(
      crypto.randomUUID(),
      tenant,
      action,
      object,
      id,
      JSON.stringify(detail),
    );
}
export function guard(db: D1Database, query: string, args: any[]) {
  const id = crypto.randomUUID();
  return {
    start: db
      .prepare(
        `INSERT INTO studio_write_guards(id,valid) VALUES (?,COALESCE(${dialectFor(db).booleanInteger(`(${query})`)},0))`,
      )
      .bind(id, ...args),
    end: db.prepare("DELETE FROM studio_write_guards WHERE id=?").bind(id),
  };
}
export async function transaction(
  db: D1Database,
  statements: D1PreparedStatement[],
) {
  try {
    return await db.batch(statements);
  } catch (e) {
    const message = String(e);
    if (message.includes("studio_unique_values"))
      return fail(
        "Ya existe un registro con el mismo valor en un campo único.",
        409,
      );
    if (
      message.includes("CHECK constraint") ||
      message.includes("studio_write_guards")
    )
      return fail(
        "Los datos cambiaron durante la operación. Recarga y vuelve a intentarlo.",
        409,
      );
    throw e;
  }
}
const canonical = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.entries(value)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, v]) => [k, canonical(v)]),
        )
      : value;
async function fingerprint(object: string, input: unknown) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(canonical({ object, input }))),
  );
  return Array.from(new Uint8Array(bytes), (v) =>
    v.toString(16).padStart(2, "0"),
  ).join("");
}
export function uniqueStatements(
  db: D1Database,
  tenant: string,
  object: StudioObject,
  id: string,
  data: Record<string, unknown>,
) {
  return fieldEntries(object)
    .filter(([, f]) => f.config?.unique)
    .flatMap(([field]) => {
      const value = data[field];
      if (value == null || value === "") return [];
      const normalized =
        typeof value === "string"
          ? value.trim().toLocaleLowerCase()
          : JSON.stringify(value);
      return [
        db
          .prepare(
            "INSERT INTO studio_unique_values(tenant_id,object_name,field_name,value,record_id) VALUES (?,?,?,?,?)",
          )
          .bind(tenant, object.name, field, normalized, id),
      ];
    });
}
export async function checkRelations(
  db: D1Database,
  tenant: string,
  object: StudioObject,
  data: Record<string, unknown>,
) {
  const checks: D1PreparedStatement[] = [];
  for (const [name, field] of fieldEntries(object))
    if (field.config?.relation) {
      const ids = field.config.multiple
        ? (data[name] ?? [])
        : data[name]
          ? [data[name]]
          : [];
      for (const id of ids as string[]) {
        if (policyFor(db))
          await getRecord(db, tenant, String(field.config.relation), id);
        const row = await db
          .prepare(
            "SELECT version FROM studio_records WHERE tenant_id=? AND object_name=? AND id=? AND deleted_at IS NULL",
          )
          .bind(tenant, field.config.relation, id)
          .first<{ version: number }>();
        if (!row)
          return fail(
            `${field.label}: el registro relacionado no existe.`,
            422,
          );
        const g = guard(
          db,
          "SELECT EXISTS(SELECT 1 FROM studio_records WHERE tenant_id=? AND object_name=? AND id=? AND deleted_at IS NULL)",
          [tenant, field.config.relation, id],
        );
        checks.push(g.start, g.end);
      }
    }
  return checks;
}
export async function assertLocalCollection(
  db: D1Database,
  tenant: string,
  name: string,
) {
  const installed = await db
    .prepare(dialectFor(db).tableExists("crm_collection_bindings").sql)
    .bind(...dialectFor(db).tableExists("crm_collection_bindings").parameters)
    .first();
  if (!installed) return;
  if (
    await db
      .prepare(
        "SELECT 1 FROM crm_collection_bindings WHERE tenant_id=? AND object_name=?",
      )
      .bind(tenant, name)
      .first()
  )
    fail(
      "Esta colección enlazada debe operarse mediante su adaptador de origen.",
      422,
    );
}
export type RecordCheckpoint = {
  before: D1PreparedStatement[];
  after: (record: StudioRecord) => D1PreparedStatement[];
};
export async function createRecord(
  db: D1Database,
  tenant: string,
  name: string,
  input: Record<string, unknown>,
  options: {
    idempotencyKey?: string;
    id?: string;
    createdBy?: string;
    checkpoint?: RecordCheckpoint;
  } = {},
) {
  await assertLocalCollection(db, tenant, name);
  const object = await getObject(db, tenant, name),
    { errors, data } = validateRecord(object, input);
  if (Object.keys(errors).length)
    return fail(Object.values(errors).join(". "), 422);
  const key = options.idempotencyKey,
    hash = key ? await fingerprint(name, input) : "";
  if (key && key.length > 200)
    return fail("Clave de idempotencia demasiado larga.", 422);
  const replay = async () => {
    const previous = key
      ? await db
          .prepare(
            "SELECT fingerprint,response FROM studio_requests WHERE tenant_id=? AND request_key=?",
          )
          .bind(tenant, key)
          .first<{ fingerprint: string; response: string }>()
      : null;
    if (previous) {
      if (previous.fingerprint !== hash)
        return fail("Esta clave ya se usó con otros datos.", 409);
      return JSON.parse(previous.response) as StudioRecord;
    }
    return null;
  };
  const previous = await replay();
  if (previous) {
    requireRecordAccess(db, name, "create", previous);
    return previous;
  }
  const id = options.id ?? crypto.randomUUID(),
    now = new Date().toISOString(),
    result = {
      ...data,
      id,
      created_at: now,
      updated_at: now,
      _version: 1,
      deleted_at: null,
      created_by: policyFor(db)?.principalId ?? options.createdBy ?? null,
    };
  requireWriteAccess(db, name, "create", null, result, Object.keys(input));
  const schemaGuard = guard(
    db,
    "SELECT version=? FROM studio_objects WHERE tenant_id=? AND name=?",
    [object.version ?? 1, tenant, name],
  );
  const statements = [
    ...(options.checkpoint?.before ?? []),
    schemaGuard.start,
    ...(await checkRelations(db, tenant, object, data)),
    db
      .prepare(
        "INSERT INTO studio_records(id,tenant_id,object_name,data,created_at,updated_at,created_by) VALUES (?,?,?,?,?,?,?)",
      )
      .bind(
        id,
        tenant,
        name,
        JSON.stringify(data),
        now,
        now,
        result.created_by,
      ),
    ...uniqueStatements(db, tenant, object, id, data),
    audit(db, tenant, "record.created", name, id, { after: data }),
    schemaGuard.end,
  ];
  if (key)
    statements.push(
      db
        .prepare(
          "INSERT INTO studio_requests(tenant_id,request_key,fingerprint,response) VALUES (?,?,?,?)",
        )
        .bind(tenant, key, hash, JSON.stringify(result)),
    );
  try {
    await transaction(db, [
      ...statements,
      ...(options.checkpoint?.after(result) ?? []),
    ]);
  } catch (e) {
    if (key) {
      const result = await replay();
      if (result) return result;
    }
    throw e;
  }
  return result;
}
export async function updateRecord(
  db: D1Database,
  tenant: string,
  name: string,
  id: string,
  input: Record<string, unknown>,
  options: { version: number; checkpoint?: RecordCheckpoint },
) {
  await assertLocalCollection(db, tenant, name);
  if (!Number.isInteger(options.version) || options.version < 1)
    return fail("Se necesita la versión del registro para editarlo.", 428);
  const object = await getObject(db, tenant, name),
    record = await getRecord(db, tenant, name, id, "update");
  if (record._version !== options.version)
    return fail(
      "Otra edición modificó este registro. Recarga antes de guardar.",
      409,
    );
  const stored = Object.fromEntries(
    fieldEntries(object).map(([key]) => [key, record[key]]),
  );
  const { errors, data } = validateRecord(object, { ...stored, ...input });
  requireWriteAccess(
    db,
    name,
    "update",
    record,
    { ...record, ...data },
    Object.keys(input),
  );
  if (Object.keys(errors).length)
    return fail(Object.values(errors).join(". "), 422);
  const schemaGuard = guard(
    db,
    "SELECT version=? FROM studio_objects WHERE tenant_id=? AND name=?",
    [object.version ?? 1, tenant, name],
  );
  const recordGuard = guard(
    db,
    "SELECT version=? AND deleted_at IS NULL FROM studio_records WHERE tenant_id=? AND object_name=? AND id=?",
    [options.version, tenant, name, id],
  );
  const now = new Date().toISOString();
  const result = {
    ...data,
    id,
    created_at: record.created_at,
    updated_at: now,
    _version: options.version + 1,
    deleted_at: null,
    ...(record.created_by ? { created_by: record.created_by } : {}),
  };
  await transaction(db, [
    ...(options.checkpoint?.before ?? []),
    schemaGuard.start,
    recordGuard.start,
    ...(await checkRelations(db, tenant, object, data)),
    db
      .prepare(
        "UPDATE studio_records SET data=?,version=version+1,updated_at=? WHERE tenant_id=? AND id=?",
      )
      .bind(JSON.stringify(data), now, tenant, id),
    db
      .prepare(
        "DELETE FROM studio_unique_values WHERE tenant_id=? AND record_id=?",
      )
      .bind(tenant, id),
    ...uniqueStatements(db, tenant, object, id, data),
    audit(db, tenant, "record.updated", name, id, {
      before: stored,
      after: data,
    }),
    recordGuard.end,
    schemaGuard.end,
    ...(options.checkpoint?.after(result) ?? []),
  ]);
  return result;
}
export async function deleteRecord(
  db: D1Database,
  tenant: string,
  name: string,
  id: string,
  options: { version: number },
) {
  await assertLocalCollection(db, tenant, name);
  const record = await getRecord(db, tenant, name, id, "delete");
  if (!Number.isInteger(options.version) || options.version < 1)
    return fail("Se necesita la versión del registro.", 428);
  if (record._version !== options.version)
    return fail("El registro cambió; recarga antes de eliminar.", 409);
  const { results } = await db
    .prepare("SELECT * FROM studio_objects WHERE tenant_id=?")
    .bind(tenant)
    .all();
  const objects = results.map(parseObject);
  // Freeze the set of schemas as well as their versions: a new relation can be added
  // by a schema publication or by creating an object during the incoming scan.
  const guards = [
    guard(db, "SELECT count(*)=? FROM studio_objects WHERE tenant_id=?", [
      objects.length,
      tenant,
    ]),
    guard(
      db,
      "SELECT version=? AND deleted_at IS NULL FROM studio_records WHERE tenant_id=? AND object_name=? AND id=?",
      [options.version, tenant, name, id],
    ),
  ];
  const pending = new Map<
    string,
    {
      object: StudioObject;
      row: any;
      before: Record<string, unknown>;
      after: Record<string, unknown>;
    }
  >();
  for (const object of objects) {
    guards.push(
      guard(
        db,
        "SELECT version=? FROM studio_objects WHERE tenant_id=? AND name=?",
        [object.version ?? 1, tenant, object.name],
      ),
    );
    for (const [field, config] of fieldEntries(object))
      if (config.config?.relation === name) {
        const condition = config.config.multiple
          ? `EXISTS (SELECT 1 FROM ${dialectFor(db).jsonEach("data", `$.${field}`, "related")} WHERE value=?)`
          : dialectFor(db).jsonCompare("data", `$.${field}`, "eq", id).sql;
        const where = `tenant_id=? AND object_name=? AND deleted_at IS NULL AND id<>? AND ${condition}`;
        const args = [tenant, object.name, id, id];
        const { results: references } = await db
          .prepare(`SELECT * FROM studio_records WHERE ${where}`)
          .bind(...args)
          .all<any>();
        guards.push(
          guard(db, `SELECT count(*)=? FROM studio_records WHERE ${where}`, [
            references.length,
            ...args,
          ]),
        );
        if (references.length && config.config.onDelete !== "clear")
          return fail(
            `Hay relaciones desde ${object.label}. Desvincula los registros o configura limpiar al eliminar.`,
            409,
          );
        for (const row of references) {
          let change = pending.get(row.id);
          if (!change) {
            const before = JSON.parse(row.data);
            change = { object, row, before, after: { ...before } };
            pending.set(row.id, change);
          }
          change.after[field] = config.config.multiple
            ? (change.after[field] as string[]).filter((value) => value !== id)
            : null;
        }
      }
  }
  const statements: D1PreparedStatement[] = [],
    relationGuards: D1PreparedStatement[] = [];
  const now = new Date().toISOString();
  for (const { object, row, before, after } of pending.values()) {
    requireWriteAccess(
      db,
      object.name,
      "update",
      parseRecord(row),
      { ...parseRecord(row), ...after },
      Object.keys(after).filter(
        (k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]),
      ),
    );
    const check = validateRecord(object, after);
    if (Object.keys(check.errors).length)
      return fail("La desvinculación dejaría datos inválidos.", 409);
    guards.push(
      guard(
        db,
        "SELECT version=? AND deleted_at IS NULL FROM studio_records WHERE tenant_id=? AND object_name=? AND id=?",
        [row.version, tenant, object.name, row.id],
      ),
    );
    relationGuards.push(
      ...(await checkRelations(db, tenant, object, check.data)),
    );
    statements.push(
      db
        .prepare(
          "UPDATE studio_records SET data=?,version=version+1,updated_at=? WHERE tenant_id=? AND id=?",
        )
        .bind(JSON.stringify(check.data), now, tenant, row.id),
      db
        .prepare(
          "DELETE FROM studio_unique_values WHERE tenant_id=? AND record_id=?",
        )
        .bind(tenant, row.id),
      ...uniqueStatements(db, tenant, object, row.id, check.data),
      audit(db, tenant, "relation.cleared", object.name, row.id, {
        before,
        after: check.data,
      }),
    );
  }
  // Older CRM installations may not have collection relation metadata yet.
  const hasCollectionRelations = await db
    .prepare(dialectFor(db).tableExists("studio_record_links").sql)
    .bind(...dialectFor(db).tableExists("studio_record_links").parameters)
    .first();
  if (hasCollectionRelations)
    statements.push(
      db
        .prepare(
          "DELETE FROM studio_record_links WHERE tenant_id=? AND ((source_id=? AND relation_id IN (SELECT id FROM studio_collection_relations WHERE tenant_id=? AND source_object=?)) OR (target_id=? AND relation_id IN (SELECT id FROM studio_collection_relations WHERE tenant_id=? AND target_object=?)))",
        )
        .bind(tenant, id, tenant, name, id, tenant, name),
    );
  // All read guards run before any mutation, including counts affected by our own clears.
  await transaction(db, [
    ...guards.map((g) => g.start),
    ...relationGuards,
    ...statements,
    db
      .prepare(
        "UPDATE studio_records SET deleted_at=?,updated_at=?,version=version+1 WHERE tenant_id=? AND id=?",
      )
      .bind(now, now, tenant, id),
    db
      .prepare(
        "DELETE FROM studio_unique_values WHERE tenant_id=? AND record_id=?",
      )
      .bind(tenant, id),
    audit(db, tenant, "record.deleted", name, id, record),
    ...guards.map((g) => g.end),
  ]);
  return { id, _version: options.version + 1 };
}
export async function restoreRecord(
  db: D1Database,
  tenant: string,
  name: string,
  id: string,
  version: number,
) {
  await assertLocalCollection(db, tenant, name);
  if (!Number.isInteger(version) || version < 1)
    return fail("Se necesita la versión del registro.", 428);
  const row = await db
    .prepare(
      "SELECT * FROM studio_records WHERE tenant_id=? AND object_name=? AND id=? AND deleted_at IS NOT NULL",
    )
    .bind(tenant, name, id)
    .first<any>();
  if (!row) return fail("El registro no está en la papelera.", 404);
  requireRecordAccess(db, name, "restore", parseRecord(row));
  const object = await getObject(db, tenant, name),
    { data, errors } = validateRecord(object, JSON.parse(row.data));
  if (Object.keys(errors).length)
    return fail(
      "La estructura actual impide restaurar: " +
        Object.values(errors).join(". "),
      409,
    );
  const g = guard(
    db,
    "SELECT version=? AND deleted_at IS NOT NULL FROM studio_records WHERE tenant_id=? AND id=?",
    [version, tenant, id],
  );
  const schemaGuard = guard(
    db,
    "SELECT version=? FROM studio_objects WHERE tenant_id=? AND name=?",
    [object.version ?? 1, tenant, name],
  );
  await transaction(db, [
    schemaGuard.start,
    g.start,
    ...(await checkRelations(db, tenant, object, data)),
    ...uniqueStatements(db, tenant, object, id, data),
    db
      .prepare(
        "UPDATE studio_records SET deleted_at=NULL,data=?,version=version+1,updated_at=? WHERE tenant_id=? AND id=?",
      )
      .bind(JSON.stringify(data), new Date().toISOString(), tenant, id),
    audit(db, tenant, "record.restored", name, id, {}),
    g.end,
    schemaGuard.end,
  ]);
  return getRecord(db, tenant, name, id);
}
