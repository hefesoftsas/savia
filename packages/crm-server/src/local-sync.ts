import type { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { Env } from "./context";
import { fail } from "./context";
import {
  createRecord,
  updateRecord,
  deleteRecord,
  getObject,
  getRecord,
  parseObject,
  parseRecord,
} from "./services";
import { disabledSolutionObjects } from "./solution-state";

// Remote adapters must explicitly implement their own replication contract before
// they can opt in. Never replicate their possibly stale local shadow records.
async function capability(
  db: D1Database,
  tenant: string,
  object: ReturnType<typeof parseObject>,
) {
  const studio = object.config.studio;
  if (studio?.business || studio?.collection) return "remote" as const;
  const exists = await db
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='crm_collection_bindings'",
    )
    .first();
  if (
    exists &&
    (await db
      .prepare(
        "SELECT 1 FROM crm_collection_bindings WHERE tenant_id=? AND object_name=?",
      )
      .bind(tenant, object.name)
      .first())
  )
    return "remote" as const;
  return "read-write" as const;
}
const mutationSchema = z
  .object({
    mutationId: z.string().min(1).max(200),
    action: z.enum(["create", "update", "delete"]),
    id: z.string().min(1).max(200),
    data: z.record(z.string(), z.unknown()).optional(),
    baseVersion: z.number().int().positive().optional(),
  })
  .strict();
export function registerLocalSync(
  app: Hono<Env>,
  onMutation?: (
    db: D1Database,
    tenant: string,
    name: string,
    before: ReturnType<typeof parseRecord> | null,
    after: ReturnType<typeof parseRecord>,
  ) => Promise<void>,
) {
  app.use("/api/local-sync/*", async (c, next) => {
    const expected = c.req.header("X-Savia-Sync-Principal");
    if (expected !== undefined && expected !== c.get("principalId"))
      return fail(
        "The authenticated principal changed. Reopen this workspace.",
        403,
      );
    await next();
  });
  app.get("/api/local-sync/manifest", async (c) => {
    const tenant = c.get("tenant"),
      db = c.env.DB,
      disabled = await disabledSolutionObjects(db, tenant);
    const { results } = await db
      .prepare("SELECT * FROM crm_objects WHERE tenant_id=? ORDER BY name")
      .bind(tenant)
      .all();
    const { results: sequenceResults } = await db
      .prepare(
        "SELECT object_name, MAX(sequence) AS latest_sequence FROM crm_sync_changes WHERE tenant_id=? GROUP BY object_name",
      )
      .bind(tenant)
      .all();
    const sequences = new Map(
      sequenceResults.map((r) => [
        String(r.object_name),
        Number(r.latest_sequence) || 0,
      ]),
    );
    const exists = await db
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='crm_collection_bindings'",
      )
      .first();
    const boundObjects = new Set<string>();
    if (exists) {
      const { results: bindingResults } = await db
        .prepare(
          "SELECT object_name FROM crm_collection_bindings WHERE tenant_id=?",
        )
        .bind(tenant)
        .all();
      for (const b of bindingResults) boundObjects.add(String(b.object_name));
    }
    const collections = results
      .map(parseObject)
      .filter((o) => !disabled.has(o.name))
      .map((object) => {
        const studio = object.config.studio;
        const isRemote = Boolean(
          studio?.business ||
            studio?.collection ||
            boundObjects.has(object.name),
        );
        return {
          name: object.name,
          object,
          capability: isRemote ? ("remote" as const) : ("read-write" as const),
          schemaVersion: object.version ?? 1,
          latestSequence: sequences.get(object.name) ?? 0,
        };
      });
    return c.json({ collections, principalId: c.get("principalId") });
  });
  app.get("/api/local-sync/pull/:collection", async (c) => {
    const tenant = c.get("tenant"),
      db = c.env.DB,
      name = c.req.param("collection"),
      object = await getObject(db, tenant, name);
    if ((await capability(db, tenant, object)) === "remote")
      return fail("This collection requires its source adapter.", 422);
    let sequence = 0;
    const cursor = c.req.query("cursor");
    if (cursor) {
      try {
        const decoded = JSON.parse(atob(cursor));
        if (
          decoded.v !== 1 ||
          decoded.tenant !== tenant ||
          decoded.collection !== name ||
          !Number.isSafeInteger(decoded.sequence) ||
          decoded.sequence < 0
        )
          throw Error();
        sequence = decoded.sequence;
      } catch {
        return fail("Invalid synchronization cursor.", 422);
      }
    }
    const limit = Number(c.req.query("limit") ?? 250);
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000)
      return fail("Invalid page limit.", 422);
    const { results } = await db
      .prepare(
        "SELECT * FROM crm_sync_changes WHERE tenant_id=? AND object_name=? AND sequence>? ORDER BY sequence LIMIT ?",
      )
      .bind(tenant, name, sequence, limit + 1)
      .all();
    const page = results.slice(0, limit);
    if (page.length) sequence = Number(page.at(-1)!.sequence);
    return c.json({
      documents: page.map(parseRecord),
      cursor: btoa(
        JSON.stringify({ v: 1, tenant, collection: name, sequence }),
      ),
      hasMore: results.length > limit,
    });
  });
  app.post("/api/local-sync/push/:collection", async (c) => {
    const tenant = c.get("tenant"),
      principal = c.get("principalId"),
      db = c.env.DB,
      name = c.req.param("collection"),
      object = await getObject(db, tenant, name);
    if ((await capability(db, tenant, object)) === "remote")
      return fail("This collection requires its source adapter.", 422);
    const mutation = mutationSchema.parse(await c.req.json()),
      fingerprint = JSON.stringify([name, mutation]);
    const replay = async () => {
      const receipt = await db
        .prepare(
          "SELECT fingerprint,response,before_state,effects_applied FROM crm_sync_receipts WHERE tenant_id=? AND principal_id=? AND mutation_id=?",
        )
        .bind(tenant, principal, mutation.mutationId)
        .first<{
          fingerprint: string;
          response: string;
          before_state: string | null;
          effects_applied: number;
        }>();
      if (!receipt) return null;
      if (receipt.fingerprint !== fingerprint)
        return fail("Mutation ID already used for another request.", 409);
      const data = parseRecord(JSON.parse(receipt.response));
      if (!receipt.effects_applied) {
        if (mutation.action !== "delete")
          await onMutation?.(
            db,
            tenant,
            name,
            receipt.before_state ? JSON.parse(receipt.before_state) : null,
            data,
          );
        await db
          .prepare(
            "UPDATE crm_sync_receipts SET effects_applied=1 WHERE tenant_id=? AND principal_id=? AND mutation_id=?",
          )
          .bind(tenant, principal, mutation.mutationId)
          .run();
      }
      return data;
    };
    const previous = await replay();
    if (previous) return c.json({ data: previous });
    // Every service writes through one transactional batch. Append the durable ACK
    // there so a crash cannot commit the mutation without recording its response.
    let before: ReturnType<typeof parseRecord> | null = null;
    const transactionalDb = {
      prepare: db.prepare.bind(db),
      batch: async (statements: D1PreparedStatement[]) =>
        db.batch([
          ...statements,
          db
            .prepare(
              `INSERT INTO crm_sync_receipts(tenant_id,principal_id,mutation_id,fingerprint,before_state,response)
   SELECT ?,?,?,?,?,json_object('id',id,'data',data,'version',version,'created_at',created_at,'updated_at',updated_at,'deleted_at',deleted_at) FROM crm_records WHERE tenant_id=? AND object_name=? AND id=?`,
            )
            .bind(
              tenant,
              principal,
              mutation.mutationId,
              fingerprint,
              before ? JSON.stringify(before) : null,
              tenant,
              name,
              mutation.id,
            ),
        ]),
    } as D1Database;
    try {
      before =
        mutation.action === "update"
          ? await getRecord(db, tenant, name, mutation.id)
          : null;
      if (mutation.action === "create")
        await createRecord(transactionalDb, tenant, name, mutation.data ?? {}, {
          id: mutation.id,
        });
      else if (mutation.action === "update")
        await updateRecord(
          transactionalDb,
          tenant,
          name,
          mutation.id,
          mutation.data ?? {},
          { version: mutation.baseVersion ?? 0 },
        );
      else
        await deleteRecord(transactionalDb, tenant, name, mutation.id, {
          version: mutation.baseVersion ?? 0,
        });
      const data = await replay();
      return c.json({ data });
    } catch (error) {
      const replayed = await replay();
      if (replayed) return c.json({ data: replayed });
      const collision =
        mutation.action === "create" &&
        String(error).includes("UNIQUE constraint");
      if (
        collision ||
        (error instanceof HTTPException &&
          (error.status === 409 || error.status === 404))
      ) {
        const master = await db
          .prepare(
            "SELECT * FROM crm_sync_changes WHERE tenant_id=? AND object_name=? AND id=? ORDER BY sequence DESC LIMIT 1",
          )
          .bind(tenant, name, mutation.id)
          .first();
        const data = master ? parseRecord(master) : null;
        return c.json(
          {
            error: "The record changed. Resolve against the current master.",
            data,
            master: data,
          },
          409,
        );
      }
      throw error;
    }
  });
}
