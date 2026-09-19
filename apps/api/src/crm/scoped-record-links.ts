import {
  accessDenied,
  projectCrmRecord,
  requireRecordAccess,
} from "@savia/crm-server/access-authorization";
import {
  assertLocalCollection,
  getObject,
  getRecord,
  parseRecord,
} from "@savia/crm-server/services";
import type { AccessPolicy } from "@savia/crm-shared/access-control";
import { createCollectionRelationsApp } from "./collection-relations";
import { decideRecord } from "@savia/crm-shared/access-evaluator";
import { accessRecord } from "@savia/crm-server/access-authorization";
import { HTTPException } from "hono/http-exception";

/** Complete local selections are returned only when every linked row is readable. */
export async function scopedRecordLinks(
  request: Request,
  db: D1Database,
  tenant: string,
  policy: AccessPolicy,
): Promise<Response> {
  try {
    const url = new URL(request.url);
    const match = /^\/api\/record-links\/([^/]+)\/([^/]+)$/.exec(url.pathname);
    if (!match || request.method !== "GET") accessDenied();
    const name = decodeURIComponent(match[1]),
      id = decodeURIComponent(match[2]);
    async function local(name: string) {
      await assertLocalCollection(db, tenant, name);
      const object = await getObject(db, tenant, name);
      const studio = object.config.studio;
      if (
        studio?.business ||
        studio?.collection ||
        studio?.capabilities?.read === false
      )
        accessDenied();
      return object;
    }
    const parentObject = await local(name);
    const parent = await getRecord(db, tenant, name, id);
    const visible = decideRecord(
      policy,
      `collection:${name}`,
      "read",
      accessRecord(parent),
    ).fields;
    const definitions = await db
      .prepare(
        "SELECT * FROM crm_collection_relations WHERE tenant_id=? AND (source_object=? OR target_object=?)",
      )
      .bind(tenant, name, name)
      .all<any>();
    const authorizedIds = new Map<string, Set<string>>();
    for (const definition of definitions.results) {
      const requestedRelation = url.searchParams.get("relationId"),
        direction = url.searchParams.get("direction");
      if (requestedRelation && requestedRelation !== definition.id) continue;
      if (
        direction &&
        !(
          (direction === "outgoing" && definition.source_object === name) ||
          (direction === "incoming" && definition.target_object === name)
        )
      )
        continue;
      if (definition.storage !== "local") accessDenied();
      const outgoing = definition.source_object === name,
        target = outgoing ? definition.target_object : definition.source_object;
      await local(target);
      for (const [key, field] of Object.entries(parentObject.config.fields))
        if (
          field.config?.collectionRelation === definition.id &&
          !visible.includes(key)
        )
          accessDenied();
      if (
        !policy.grants.some(
          (g) => g.resource === `collection:${target}` && g.action === "read",
        )
      )
        accessDenied();
      const rows = await db
        .prepare(
          `SELECT r.* FROM crm_record_links l JOIN crm_records r ON r.tenant_id=l.tenant_id AND r.id=l.${outgoing ? "target_id" : "source_id"} AND r.object_name=? WHERE l.tenant_id=? AND l.relation_id=? AND l.${outgoing ? "source_id" : "target_id"}=? LIMIT 10001`,
        )
        .bind(target, tenant, definition.id, id)
        .all();
      const count = await db
        .prepare(
          `SELECT count(*) n FROM crm_record_links WHERE tenant_id=? AND relation_id=? AND ${outgoing ? "source_id" : "target_id"}=?`,
        )
        .bind(tenant, definition.id, id)
        .first<{ n: number }>();
      if (rows.results.length > 10000 || count?.n !== rows.results.length)
        accessDenied();
      for (const row of rows.results)
        requireRecordAccess(db, target, "read", parseRecord(row));
      authorizedIds.set(
        definition.id,
        new Set(rows.results.map((row) => String(row.id))),
      );
    }
    const response = await createCollectionRelationsApp({
      db,
      tenant,
      readRecord: async (name, id) =>
        projectCrmRecord(policy, name, await getRecord(db, tenant, name, id)),
    }).fetch(request);
    if (!response.ok) return response;
    const body = (await response.json()) as {
      data: Array<{
        definition: { id: string };
        total: number;
        records: Array<{ id: string; missing?: boolean }>;
        targetObject: string;
        targetColumns?: Array<{ key?: string; name?: string }>;
        canEdit: boolean;
      }>;
    };
    for (const group of body.data) {
      const ids = authorizedIds.get(group.definition.id);
      if (
        !ids ||
        ids.size !== group.total ||
        group.records.some((record) => record.missing || !ids.has(record.id))
      )
        accessDenied();
      // The adapter's schema columns are unprojected; omit them instead of exposing hidden fields.
      delete group.targetColumns;
      group.canEdit = false;
    }
    return Response.json(body, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof HTTPException)
      return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}

/** Read-only local relation metadata for collections visible to the policy. */
export async function scopedRelationDefinitions(
  db: D1Database,
  tenant: string,
  policy: AccessPolicy,
): Promise<Response> {
  const rows = await db
    .prepare(
      'SELECT id,source_object AS "sourceObject",target_object AS "targetObject",source_label AS "sourceLabel",target_label AS "targetLabel",cardinality,source_field AS "sourceField",target_field AS "targetField",source_display_field AS "sourceDisplayField",target_display_field AS "targetDisplayField",storage,version FROM crm_collection_relations WHERE tenant_id=? AND storage=\'local\' ORDER BY id LIMIT 501',
    )
    .bind(tenant)
    .all<any>();
  const data = [];
  for (const definition of rows.results) {
    try {
      for (const name of [definition.sourceObject, definition.targetObject]) {
        if (
          !policy.grants.some(
            (g) => g.resource === `collection:${name}` && g.action === "read",
          )
        )
          accessDenied();
        await assertLocalCollection(db, tenant, name);
        const object = await getObject(db, tenant, name);
        if (
          object.config.studio?.business ||
          object.config.studio?.collection ||
          object.config.studio?.capabilities?.read === false
        )
          accessDenied();
      }
      for (const side of ["source", "target"]) {
        const grants = policy.grants.filter(
          (g) =>
            g.resource === `collection:${definition[side + "Object"]}` &&
            g.action === "read",
        );
        if (
          !grants.every((g) =>
            g.fields.includes(definition[side + "DisplayField"]),
          )
        )
          definition[side + "DisplayField"] = null;
      }
      data.push(definition);
    } catch (error) {
      if (!(
        error instanceof HTTPException && [403, 404, 422].includes(error.status)
      ))
        throw error;
    }
  }
  return Response.json({ data }, { headers: { "cache-control": "no-store" } });
}
