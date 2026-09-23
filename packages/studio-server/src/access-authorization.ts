import {
  dialectFor,
  registerDialect,
  sqliteDialect,
  type SqlDialect,
} from "@savia/db/dialect";
import type {
  AccessAction,
  AccessPolicy,
  AccessRecord,
} from "@savia/studio-shared/access-control";
import {
  decideRecord,
  decideWrite,
  projectRecord,
} from "@savia/studio-shared/access-evaluator";
import type { StudioObject, StudioRecord } from "@savia/studio-shared/metadata";
import { HTTPException } from "hono/http-exception";
const contexts = new WeakMap<D1Database, AccessPolicy>();
export const policyFor = (db: D1Database) => contexts.get(db);
/** Preserve policy metadata when a wrapper delegates to an already guarded database. */
export function inheritAccessPolicy(
  source: D1Database,
  target: D1Database,
): D1Database {
  registerDialect(target, dialectFor(source));
  const policy = policyFor(source);
  if (policy) contexts.set(target, policy);
  return target;
}
export function accessDenied(): never {
  throw new HTTPException(403, {
    message: "You do not have permission for this operation.",
  });
}
export function accessDatabase(db: D1Database, policy: AccessPolicy) {
  const wrapped = new Proxy(db, {
    get(target, key) {
      if (key === "batch")
        return async (statements: D1PreparedStatement[]) => {
          const id = crypto.randomUUID();
          const result = await target.batch([
            target
              .prepare(
                `INSERT INTO crm_write_guards(id,valid) SELECT ?,COALESCE((SELECT ${dialectFor(db).booleanInteger("revision=?")} FROM access_revisions WHERE scope=?),0)`,
              )
              .bind(id, policy.revision, policy.scope),
            ...statements,
            target.prepare("DELETE FROM crm_write_guards WHERE id=?").bind(id),
          ]);
          return result.slice(1, -1);
        };
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  registerDialect(wrapped, dialectFor(db));
  contexts.set(wrapped, policy);
  return wrapped;
}
export function accessRecord(record: StudioRecord): AccessRecord {
  return {
    id: record.id,
    createdBy: typeof record.created_by === "string" ? record.created_by : null,
    values: Object.fromEntries(
      Object.entries(record).filter(
        ([k]) =>
          ![
            "id",
            "created_at",
            "updated_at",
            "deleted_at",
            "_version",
            "created_by",
          ].includes(k),
      ),
    ),
  };
}
export function requireRecordAccess(
  db: D1Database,
  name: string,
  action: AccessAction,
  record: StudioRecord,
) {
  const policy = policyFor(db);
  if (
    policy &&
    !decideRecord(policy, `collection:${name}`, action, accessRecord(record))
      .allowed
  )
    accessDenied();
}
export function requireWriteAccess(
  db: D1Database,
  name: string,
  action: "create" | "update",
  before: StudioRecord | null,
  after: StudioRecord,
  fields: string[],
) {
  const policy = policyFor(db);
  if (
    policy &&
    !decideWrite(
      policy,
      `collection:${name}`,
      action,
      before ? accessRecord(before) : null,
      accessRecord(after),
      fields,
    ).allowed
  )
    accessDenied();
}
export function projectCrmRecord(
  policy: AccessPolicy,
  name: string,
  record: StudioRecord,
  action: AccessAction = "read",
): StudioRecord {
  const projected = projectRecord(
    accessRecord(record),
    decideRecord(policy, `collection:${name}`, action, accessRecord(record)),
  );
  return {
    ...projected.values,
    id: record.id,
    created_at: record.created_at,
    updated_at: record.updated_at,
    _version: record._version,
    deleted_at: record.deleted_at,
  };
}
export function accessColumns(
  object: StudioObject,
  dialect: SqlDialect = sqliteDialect,
) {
  return Object.fromEntries([
    ["$createdBy", "created_by"],
    ...Object.keys(object.config.fields)
      .filter((f) => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(f))
      .map((f) => [
        f,
        {
          expression: dialect.jsonValue("data", "$." + f),
          type: dialect.jsonType("data", "$." + f),
          document: "data",
          path: "$." + f,
        },
      ]),
  ]);
}
export function queryAccessFields(policy: AccessPolicy, name: string) {
  const grants = policy.grants.filter(
    (g) => g.resource === `collection:${name}` && g.action === "read",
  );
  return grants.length
    ? grants[0].fields.filter((f) => grants.every((g) => g.fields.includes(f)))
    : [];
}
export function requireQueryAccess(
  policy: AccessPolicy,
  name: string,
  params: Record<string, string | undefined>,
  pipeline = "stage",
) {
  const allowed = new Set([
    ...queryAccessFields(policy, name),
    "id",
    "created_at",
    "updated_at",
  ]);
  const searchable = new Set(queryAccessFields(policy, name));
  if (
    [params.searchField, ...(params.searchFields?.split(",") ?? [])]
      .filter(Boolean)
      .some((f) => !searchable.has(f!))
  )
    accessDenied();
  const queried = [
    params.sort,
    params.group,
    params.amountField,
    params.searchField,
    ...(params.searchFields?.split(",") ?? []),
  ].filter(Boolean) as string[];
  if (params.stage || params.emptyStage) queried.push(pipeline);
  if (params.filters) {
    let filters;
    try {
      filters = JSON.parse(params.filters);
    } catch {
      throw new HTTPException(422, { message: "Invalid filters." });
    }
    for (const c of filters.conditions ?? []) queried.push(c.field);
  }
  if (queried.some((f) => !allowed.has(f))) accessDenied();
  if (params.q && !params.searchField && !params.searchFields) {
    const fields = queryAccessFields(policy, name);
    if (!fields.length) accessDenied();
    params.searchFields = fields.join(",");
  }
}
