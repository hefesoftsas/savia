import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { bodyLimit } from "hono/body-limit";
import { z } from "@hono/zod-openapi";
import {
  fieldEntries,
  validateRecord,
  type CrmRecord,
} from "@savia/crm-shared/metadata";
import {
  assertLocalCollection,
  audit,
  checkRelations,
  getObject,
  parseRecord,
  guard,
  transaction,
  uniqueStatements,
} from "@savia/crm-server/services";
import {
  runAutomations,
  type AutomationRuleSnapshot,
} from "@savia/crm-server/operations";
const rowSchema = z
  .object({
    id: z.string().min(1).max(512).optional(),
    version: z.number().int().positive().optional(),
    data: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
const schema = z
  .object({
    record: rowSchema.extend({ data: z.record(z.string(), z.unknown()) }),
    relations: z
      .array(
        z
          .object({
            relationId: z.string().min(1).max(512),
            previousIds: z
              .array(z.string().min(1).max(512))
              .max(100)
              .optional(),
            rows: z.array(rowSchema).max(100),
          })
          .strict(),
      )
      .max(10),
  })
  .strict();
function fail(
  message: string,
  status: 403 | 404 | 409 | 422 | 428 = 422,
): never {
  throw new HTTPException(status, { message });
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
export function createRecordBundlesApp({
  db,
  tenant,
}: {
  db: D1Database;
  tenant: string;
}) {
  const app = new Hono();
  app.onError((error, c) =>
    error instanceof HTTPException
      ? c.json({ error: error.message }, error.status)
      : c.json({ error: "Unable to save related records." }, 500),
  );
  app.use(
    "*",
    bodyLimit({
      maxSize: 1024 * 1024,
      onError: (c) => c.json({ error: "Record bundle exceeds 1 MiB." }, 413),
    }),
  );
  app.post("/api/record-bundles/:object", async (c) => {
    const parsed = schema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) fail("Invalid record bundle.");
    const input = parsed.data,
      name = c.req.param("object"),
      key = c.req.header("Idempotency-Key");
    if (!key?.trim() || key.length > 200)
      fail("Idempotency-Key is required (1–200 characters).", 428);
    if (input.relations.reduce((n, g) => n + g.rows.length, 0) > 100)
      fail("At most 100 related rows are supported.");
    if (
      new Set(input.relations.map((g) => g.relationId)).size !==
      input.relations.length
    )
      fail("Duplicate relation group.");
    const hash = Array.from(
      new Uint8Array(
        await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(
            JSON.stringify(
              canonical({ operation: "record-bundle", name, input }),
            ),
          ),
        ),
      ),
      (byte) => byte.toString(16).padStart(2, "0"),
    ).join("");
    async function deliver(
      events: { name: string; before: CrmRecord | null; after: CrmRecord }[],
      rules: Record<string, AutomationRuleSnapshot[]>,
    ) {
      let complete = true;
      for (const event of events)
        try {
          const delivery = await runAutomations(
            db,
            tenant,
            event.name,
            event.before,
            event.after,
            { rules: rules[event.name] ?? [] },
          );
          if (!delivery.delivered) complete = false;
        } catch (error) {
          complete = false;
          await audit(
            db,
            tenant,
            "automation.failed",
            event.name,
            event.after.id,
            { error: String(error) },
          ).run();
        }
      return complete;
    }
    async function deliverSaved(saved: {
      result: unknown;
      events: typeof events;
      rules: Record<string, AutomationRuleSnapshot[]>;
      deliveryComplete?: boolean;
    }) {
      if (saved.deliveryComplete) return;
      if (await deliver(saved.events ?? [], saved.rules ?? {})) {
        await db
          .prepare(
            "UPDATE crm_requests SET response=? WHERE tenant_id=? AND request_key=? AND fingerprint=?",
          )
          .bind(
            JSON.stringify({ ...saved, deliveryComplete: true }),
            tenant,
            key,
            hash,
          )
          .run();
      }
    }
    const replay = async () => {
      const old = await db
        .prepare(
          "SELECT fingerprint,response FROM crm_requests WHERE tenant_id=? AND request_key=?",
        )
        .bind(tenant, key)
        .first<{ fingerprint: string; response: string }>();
      if (!old) return null;
      if (old.fingerprint !== hash)
        fail("This idempotency key was used with other data.", 409);
      const saved = JSON.parse(old.response);
      await deliverSaved(saved);
      return saved.result ?? saved;
    };
    // Replays return the original committed result even when a later edit changed versions.
    const guards: ReturnType<typeof guard>[] = [],
      writes: D1PreparedStatement[] = [],
      events: { name: string; before: CrmRecord | null; after: CrmRecord }[] =
        [];
    const touched = new Set<string>();
    const objectCache = new Map<
      string,
      Awaited<ReturnType<typeof getObject>>
    >();
    async function local(
      objectName: string,
      action: "read" | "create" | "update",
    ) {
      const cached = objectCache.get(objectName);
      if (cached) {
        const caps =
          cached.config.studio?.capabilities ??
          cached.config.studio?.collection?.capabilities;
        if (caps && (caps.read === false || caps[action] === false))
          fail(`Collection ${objectName} does not allow ${action}.`, 403);
        return cached;
      }
      await assertLocalCollection(db, tenant, objectName);
      const object = await getObject(db, tenant, objectName),
        studio = object.config.studio;
      if (studio?.business || studio?.collection)
        fail("Related editing supports local collections only.");
      const caps = studio?.capabilities ?? studio?.collection?.capabilities;
      if (caps && (caps.read === false || caps[action] === false))
        fail(`Collection ${objectName} does not allow ${action}.`, 403);
      guards.push(
        guard(
          db,
          "SELECT version=? FROM crm_objects WHERE tenant_id=? AND name=?",
          [object.version ?? 1, tenant, objectName],
        ),
      );
      guards.push(
        guard(
          db,
          "SELECT NOT EXISTS(SELECT 1 FROM crm_collection_bindings WHERE tenant_id=? AND object_name=?)",
          [tenant, objectName],
        ),
      );
      guards.push(
        guard(
          db,
          "SELECT NOT EXISTS(SELECT 1 FROM crm_solution_objects o JOIN crm_solution_installations s ON s.tenant_id=o.tenant_id AND s.id=o.solution_id WHERE o.tenant_id=? AND o.object_name=? AND s.enabled=0)",
          [tenant, objectName],
        ),
      );
      objectCache.set(objectName, object);
      return object;
    }
    async function prepare(
      objectName: string,
      row: z.infer<typeof rowSchema>,
      child = false,
    ) {
      const editing = !!row.id,
        object = await local(
          objectName,
          row.data === undefined ? "read" : editing ? "update" : "create",
        );
      if (!row.id && row.data === undefined) fail("A new row requires data.");
      const existing = row.id
        ? await db
            .prepare(
              "SELECT * FROM crm_records WHERE tenant_id=? AND object_name=? AND id=? AND deleted_at IS NULL",
            )
            .bind(tenant, objectName, row.id)
            .first()
        : null;
      if (row.id && !existing) fail("The related record does not exist.", 404);
      const before = existing ? parseRecord(existing) : null;
      if (before)
        guards.push(
          guard(
            db,
            "SELECT version=? AND deleted_at IS NULL FROM crm_records WHERE tenant_id=? AND object_name=? AND id=?",
            [before._version, tenant, objectName, row.id],
          ),
        );
      if (row.data === undefined) {
        if (row.version !== undefined)
          fail("A link-only row must contain only id.");
        return before!;
      }
      if (before && (!row.version || row.version !== before._version))
        fail("Record version is missing or changed.", row.version ? 409 : 428);
      const identity = `${objectName}:${row.id ?? crypto.randomUUID()}`;
      if (touched.has(identity))
        fail("A record can be edited only once per bundle.");
      touched.add(identity);
      if (child)
        for (const [field, value] of Object.entries(row.data)) {
          const f = object.config.fields[field];
          if (
            value !== undefined &&
            (f?.config?.relation ||
              f?.config?.collectionRelation ||
              f?.type === "R2Attachment")
          )
            fail(
              `Nested relations and attachments cannot be edited (${field}).`,
            );
        }
      for (const [field, value] of Object.entries(row.data)) {
        const f = object.config.fields[field];
        if (
          f?.readOnly &&
          JSON.stringify(value) !== JSON.stringify(before?.[field])
        )
          fail(`Field ${field} is read-only.`, 403);
      }
      const stored = before
        ? Object.fromEntries(fieldEntries(object).map(([k]) => [k, before[k]]))
        : {};
      const { data, errors } = validateRecord(
        {
          ...object,
          config: {
            ...object.config,
            fields: Object.fromEntries(
              fieldEntries(object).filter(
                ([, f]) => !f.config?.collectionRelation,
              ),
            ),
            fieldOrder: fieldEntries(object)
              .filter(([, f]) => !f.config?.collectionRelation)
              .map(([k]) => k),
          },
        },
        Object.fromEntries(
          Object.entries({ ...stored, ...row.data }).filter(
            ([key]) => !object.config.fields[key]?.config?.collectionRelation,
          ),
        ),
      );
      if (Object.keys(errors).length) fail(Object.values(errors).join(". "));
      if (child && !before) {
        const nested = validateRecord(object, {
          ...data,
          ...Object.fromEntries(
            fieldEntries(object)
              .filter(([, field]) => field.config?.collectionRelation)
              .map(([key, field]) => [key, field.config?.multiple ? [] : null]),
          ),
        });
        if (Object.keys(nested.errors).length)
          fail(
            "A required nested relation cannot be supplied in a one-level bundle: " +
              Object.values(nested.errors).join(". "),
          );
      }
      writes.push(...(await checkRelations(db, tenant, object, data)));
      const id = before?.id ?? identity.slice(objectName.length + 1),
        now = new Date().toISOString();
      if (before)
        writes.push(
          db
            .prepare(
              "UPDATE crm_records SET data=?,version=version+1,updated_at=? WHERE tenant_id=? AND object_name=? AND id=?",
            )
            .bind(JSON.stringify(data), now, tenant, objectName, id),
          db
            .prepare(
              "DELETE FROM crm_unique_values WHERE tenant_id=? AND record_id=?",
            )
            .bind(tenant, id),
        );
      else
        writes.push(
          db
            .prepare(
              "INSERT INTO crm_records(id,tenant_id,object_name,data,created_at,updated_at) VALUES(?,?,?,?,?,?)",
            )
            .bind(id, tenant, objectName, JSON.stringify(data), now, now),
        );
      writes.push(
        ...uniqueStatements(db, tenant, object, id, data),
        audit(
          db,
          tenant,
          before ? "record.updated" : "record.created",
          objectName,
          id,
          { before: stored, after: data },
        ),
      );
      const after = {
        ...data,
        id,
        created_at: before?.created_at ?? now,
        updated_at: now,
        _version: (before?._version ?? 0) + 1,
        deleted_at: null,
      } as CrmRecord;
      events.push({ name: objectName, before, after });
      return after;
    }
    await local(name, "read");
    for (const group of input.relations) {
      const relation = await db
        .prepare(
          "SELECT source_object,target_object FROM crm_collection_relations WHERE tenant_id=? AND id=?",
        )
        .bind(tenant, group.relationId)
        .first<{ source_object: string; target_object: string }>();
      if (
        !relation ||
        ![relation.source_object, relation.target_object].includes(name)
      )
        fail("Relation not found.", 404);
      await local(
        relation.source_object === name
          ? relation.target_object
          : relation.source_object,
        "read",
      );
    }
    const old = await replay();
    if (old) return c.json(old);
    const parent = await prepare(name, input.record),
      related: { relationId: string; records: CrmRecord[] }[] = [];
    for (const group of input.relations) {
      try {
        const relation = await db
          .prepare(
            "SELECT * FROM crm_collection_relations WHERE tenant_id=? AND id=?",
          )
          .bind(tenant, group.relationId)
          .first<any>();
        if (
          !relation ||
          ![relation.source_object, relation.target_object].includes(name)
        )
          fail("Relation not found.", 404);
        if (relation.storage !== "local")
          fail("Only local relations support related editing.");
        guards.push(
          guard(
            db,
            "SELECT version=? AND storage='local' FROM crm_collection_relations WHERE tenant_id=? AND id=?",
            [relation.version, tenant, group.relationId],
          ),
        );
        const outgoing = relation.source_object === name,
          target = outgoing ? relation.target_object : relation.source_object,
          field = outgoing ? "source_id" : "target_id",
          other = outgoing ? "target_id" : "source_id";
        await local(target, "read");
        const ids = (
          await db
            .prepare(
              `SELECT ${other} id FROM crm_record_links WHERE tenant_id=? AND relation_id=? AND ${field}=? ORDER BY ${other}`,
            )
            .bind(tenant, group.relationId, parent.id)
            .all<{ id: string }>()
        ).results.map((r) => r.id);
        if (input.record.id && !group.previousIds)
          fail("The previous relation selection is required.", 428);
        if (
          group.previousIds &&
          JSON.stringify([...new Set(group.previousIds)].sort()) !==
            JSON.stringify(ids)
        )
          fail("The relation selection changed. Reload before saving.", 409);
        guards.push(
          guard(
            db,
            `SELECT COALESCE(json_group_array(id),'[]')=? FROM (SELECT ${other} id FROM crm_record_links WHERE tenant_id=? AND relation_id=? AND ${field}=? ORDER BY ${other})`,
            [JSON.stringify(ids), tenant, group.relationId, parent.id],
          ),
        );
        if (
          group.rows.length > 1 &&
          (relation.cardinality === "one-to-one" ||
            (!outgoing && relation.cardinality === "one-to-many"))
        )
          fail("Relation cardinality allows only one record.", 409);
        const bindings = fieldEntries(objectCache.get(name)!).filter(
          ([, f]) => f.config?.collectionRelation === group.relationId,
        );
        for (const [, binding] of bindings) {
          const options = binding.config ?? {};
          if (
            binding.readOnly &&
            (group.rows.some((r) => r.data !== undefined) ||
              JSON.stringify(group.rows.map((r) => r.id).sort()) !==
                JSON.stringify(ids))
          )
            fail("This relation field is read-only.", 403);
          if (
            options.relationAllowCreate === false &&
            group.rows.some((r) => !r.id)
          )
            fail("Creating related rows is disabled.", 403);
          if (
            options.relationAllowEdit === false &&
            group.rows.some((r) => r.id && r.data !== undefined)
          )
            fail("Editing related rows is disabled.", 403);
          if (
            options.relationAllowLink === false &&
            group.rows.some((r) => r.id && !ids.includes(r.id))
          )
            fail("Linking existing rows is disabled.", 403);
          if (
            options.relationAllowUnlink === false &&
            ids.some((id) => !group.rows.some((r) => r.id === id))
          )
            fail("Unlinking rows is disabled.", 403);
        }
        const records: CrmRecord[] = [];
        for (const [index, row] of group.rows.entries())
          try {
            const record = await prepare(target, row, true);
            if (records.some((r) => r.id === record.id))
              fail("Duplicate related record.");
            records.push(record);
          } catch (error) {
            if (error instanceof HTTPException)
              fail(`row ${index + 1}: ${error.message}`, error.status as 422);
            throw error;
          }
        writes.push(
          db
            .prepare(
              `DELETE FROM crm_record_links WHERE tenant_id=? AND relation_id=? AND ${field}=?`,
            )
            .bind(tenant, group.relationId, parent.id),
        );
        for (const record of records)
          writes.push(
            db
              .prepare(
                "INSERT INTO crm_record_links(tenant_id,relation_id,source_id,target_id) VALUES(?,?,?,?)",
              )
              .bind(
                tenant,
                group.relationId,
                outgoing ? parent.id : record.id,
                outgoing ? record.id : parent.id,
              ),
          );
        writes.push(
          audit(db, tenant, "relation.updated", name, parent.id, {
            relationId: group.relationId,
            before: ids,
            after: records.map((r) => r.id),
          }),
        );
        related.push({ relationId: group.relationId, records });
      } catch (error) {
        if (error instanceof HTTPException)
          fail(
            `Relation ${group.relationId}: ${error.message}`,
            error.status as 422,
          );
        throw error;
      }
    }
    // Bound relation fields are virtual: validate their effective selections without persisting them.
    const parentObject = objectCache.get(name)!,
      validationData: Record<string, unknown> = Object.fromEntries(
        fieldEntries(parentObject).map(([key]) => [key, parent[key]]),
      );
    for (const [field, binding] of fieldEntries(parentObject))
      if (binding.config?.collectionRelation) {
        const relationId = binding.config.collectionRelation,
          submitted = related.find((g) => g.relationId === relationId);
        let selected = submitted?.records.map((r) => r.id);
        if (!selected) {
          const definition = await db
            .prepare(
              "SELECT * FROM crm_collection_relations WHERE tenant_id=? AND id=?",
            )
            .bind(tenant, relationId)
            .first<any>();
          if (
            !definition ||
            ![definition.source_object, definition.target_object].includes(name)
          )
            fail(`Relation ${relationId} is unavailable.`, 404);
          guards.push(
            guard(
              db,
              "SELECT version=? FROM crm_collection_relations WHERE tenant_id=? AND id=?",
              [definition.version, tenant, relationId],
            ),
          );
          const fieldName =
              definition.source_object === name ? "source_id" : "target_id",
            otherName =
              definition.source_object === name ? "target_id" : "source_id";
          selected = (
            await db
              .prepare(
                `SELECT ${otherName} id FROM crm_record_links WHERE tenant_id=? AND relation_id=? AND ${fieldName}=? ORDER BY ${otherName}`,
              )
              .bind(tenant, relationId, parent.id)
              .all<{ id: string }>()
          ).results.map((r) => r.id);
          guards.push(
            guard(
              db,
              `SELECT COALESCE(json_group_array(id),'[]')=? FROM (SELECT ${otherName} id FROM crm_record_links WHERE tenant_id=? AND relation_id=? AND ${fieldName}=? ORDER BY ${otherName})`,
              [JSON.stringify(selected), tenant, relationId, parent.id],
            ),
          );
        }
        validationData[field] = binding.config.multiple
          ? selected
          : (selected[0] ?? null);
      }
    const finalValidation = validateRecord(parentObject, validationData);
    if (Object.keys(finalValidation.errors).length)
      fail(Object.values(finalValidation.errors).join(". "));
    const result = { data: parent, related };
    const rules: Record<string, AutomationRuleSnapshot[]> = {};
    for (const objectName of new Set(events.map((event) => event.name))) {
      rules[objectName] = (
        await db
          .prepare(
            "SELECT id,version,name,config FROM crm_automations WHERE tenant_id=? AND object_name=? AND enabled=1 ORDER BY id",
          )
          .bind(tenant, objectName)
          .all<AutomationRuleSnapshot>()
      ).results;
      guards.push(
        guard(
          db,
          "SELECT COALESCE(json_group_array(json_object('id',id,'version',version)), '[]')=? FROM (SELECT id,version FROM crm_automations WHERE tenant_id=? AND object_name=? AND enabled=1 ORDER BY id)",
          [
            JSON.stringify(
              rules[objectName].map(({ id, version }) => ({ id, version })),
            ),
            tenant,
            objectName,
          ],
        ),
      );
    }
    const saved = { result, events, rules, deliveryComplete: false };
    try {
      await transaction(db, [
        ...guards.map((g) => g.start),
        ...writes,
        ...guards.map((g) => g.end),
        db
          .prepare(
            "INSERT INTO crm_requests(tenant_id,request_key,fingerprint,response) VALUES(?,?,?,?)",
          )
          .bind(tenant, key, hash, JSON.stringify(saved)),
      ]);
    } catch (error) {
      const saved = await replay();
      if (saved) return c.json(saved);
      if (String(error).includes("relation_cardinality_conflict"))
        fail("Relation cardinality does not allow this selection.", 409);
      throw error;
    }
    await deliverSaved(saved);
    return c.json(result);
  });
  return app;
}
