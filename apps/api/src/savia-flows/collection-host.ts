import type { OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { z } from "@hono/zod-openapi";
import type {
  SaviaCollectionCall,
  SaviaCollectionEvent,
  SaviaCollectionIdentity,
  SaviaCollectionSchema,
} from "@savia/studio-shared/savia-flows";
import type { AccessPolicy } from "@savia/studio-shared/access-control";
import type { StudioRecord } from "@savia/studio-shared/metadata";
import { fieldEntries } from "@savia/studio-shared/metadata";
import {
  accessDatabase,
  projectCrmRecord,
  requireRecordAccess,
  requireWriteAccess,
} from "@savia/studio-server/access-authorization";
import {
  assertLocalCollection,
  createRecord,
  deleteRecord,
  getObject,
  getRecord,
  parseRecord,
  updateRecord,
  type RecordCheckpoint,
} from "@savia/studio-server/services";
import { historyDatabase } from "@savia/studio-server/record-history-storage";
import { CollectionEventOutbox } from "@savia/studio-server/collection-event-outbox";
import { buildWhere } from "@savia/studio-server/query";
import { dialectFor } from "@savia/db/dialect";
import { hasCustomAccess } from "../auth/access-context";
import { loadAccessPolicy } from "../auth/access-repository";
import type { AppActor } from "../auth/types";
import { canManageSharedCrm } from "../external-crm/hubspot-access";
import type { SaviaFlowsOptions } from "../routes/savia-flows";
import { bodyDigest, verifyCollectionCall } from "./protocol";

const safeName = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,127}$/);
const recordData = z
  .record(z.string(), z.unknown())
  .refine(
    (v) =>
      !Object.keys(v).some((k) =>
        ["__proto__", "prototype", "constructor"].includes(k),
      ),
  );
const callSchema = z
  .object({
    action: z.enum([
      "catalog",
      "list",
      "read",
      "create",
      "update",
      "delete",
      "authorize-event",
    ]),
    collection: safeName.optional(),
    recordId: z.string().min(1).max(200).optional(),
    version: z.number().int().positive().optional(),
    data: recordData.optional(),
    filters: z
      .record(
        safeName,
        z.union([z.string(), z.number(), z.boolean(), z.null()]),
      )
      .refine((v) => Object.keys(v).length <= 20)
      .optional(),
    page: z.number().int().min(1).max(10000).optional(),
    pageSize: z.number().int().min(1).max(100).optional(),
    eventId: z.string().min(1).max(200).optional(),
    cause: z
      .object({
        rootEventId: z.string().min(1).max(200),
        workflowIds: z.array(z.string().min(1).max(128)).max(8),
        depth: z.number().int().min(0).max(8),
      })
      .strict()
      .optional(),
  })
  .strict();

function fail(
  message: string,
  status: 403 | 409 | 422 | 428 | 503 = 422,
): never {
  throw new HTTPException(status, { message });
}

async function loadNativeActor(
  db: D1Database,
  principalId: string,
  tenant: string,
): Promise<AppActor> {
  const tenantId = Number(tenant.slice(7));
  const principal = await db
    .prepare("SELECT * FROM identity_principal WHERE id=? AND is_active=1")
    .bind(principalId)
    .first<any>();
  const scope = await db
    .prepare("SELECT id,kind FROM tenants WHERE id=? AND is_active=1")
    .bind(tenantId)
    .first<any>();
  const membership = await db
    .prepare(
      "SELECT * FROM identity_tenant_membership WHERE principal_id=? AND tenant_id=? AND is_active=1",
    )
    .bind(principalId, tenantId)
    .first<any>();
  const admin = await db
    .prepare(
      "SELECT 1 FROM identity_global_role WHERE principal_id=? AND role='platform_admin'",
    )
    .bind(principalId)
    .first();
  if (
    !principal ||
    !scope ||
    (!membership && !admin) ||
    !(
      scope.kind === "commercial" ||
      (scope.kind === "platform" && tenantId === 0 && admin)
    )
  )
    fail("Current tenant membership is required.", 403);
  return {
    principal: {
      id: principal.id,
      issuer: principal.issuer,
      subject: principal.subject,
      email: principal.email,
      displayName: principal.display_name,
      isActive: true,
      createdAt: principal.created_at,
      updatedAt: principal.updated_at,
    },
    globalRoles: admin ? ["platform_admin"] : [],
    memberships: membership
      ? [
          {
            id: membership.id,
            principalId,
            agencyId: tenantId,
            tenantId,
            role: membership.role,
            isActive: true,
            createdAt: membership.created_at,
            updatedAt: membership.updated_at,
          },
        ]
      : [],
  };
}

const project = (
  policy: AccessPolicy | undefined,
  name: string,
  record: Record<string, unknown>,
) => (policy ? projectCrmRecord(policy, name, record as StudioRecord) : record);

type Receipt = {
  data: Record<string, unknown>;
  before: StudioRecord | null;
  after: StudioRecord;
  fields: string[];
};

export async function executeNativeCollectionCall(
  db: D1Database,
  identity: SaviaCollectionIdentity,
  call: SaviaCollectionCall,
) {
  const actor = await loadNativeActor(
    db,
    identity.principalId,
    identity.tenant,
  );
  const manager = canManageSharedCrm(actor, identity.tenant);
  const policy =
    !manager &&
    (await hasCustomAccess(
      db,
      actor.principal.id,
      identity.tenant as `tenant:${number}`,
    ))
      ? await loadAccessPolicy(db, actor, identity.tenant as `tenant:${number}`)
      : undefined;
  if (!manager && !policy) fail("A collection access grant is required.", 403);
  let scoped = policy ? accessDatabase(db, policy) : db;

  if (call.action === "catalog") {
    const rows = await db
      .prepare(
        "SELECT * FROM studio_objects WHERE tenant_id=? ORDER BY label,name LIMIT 200",
      )
      .bind(identity.tenant)
      .all<any>();
    const collections: SaviaCollectionSchema[] = [];
    for (const row of rows.results) {
      try {
        await assertLocalCollection(db, identity.tenant, row.name);
        const object = await getObject(scoped, identity.tenant, row.name);
        const grants =
          policy?.grants.filter(
            (g) => g.resource === `collection:${row.name}`,
          ) ?? [];
        const capabilities = Object.fromEntries(
          ["list", "read", "create", "update", "delete"].map((action) => [
            action,
            object.config.studio?.capabilities?.[action as "read"] !== false &&
              (manager ||
                grants.some(
                  (g) => g.action === (action === "list" ? "read" : action),
                )),
          ]),
        ) as SaviaCollectionSchema["capabilities"];
        if (!Object.values(capabilities).some(Boolean)) continue;
        collections.push({
          name: object.name,
          label: object.label,
          capabilities,
          fields: fieldEntries(object)
            .filter(
              ([name]) =>
                manager || grants.some((g) => g.fields.includes(name)),
            )
            .map(([name, field]) => ({
              name,
              label: field.label,
              type: field.type,
              required: Boolean(field.required),
              readOnly: Boolean(field.readOnly),
              options: field.config?.options,
            })),
        });
      } catch (error) {
        if (!(error instanceof HTTPException)) throw error;
      }
    }
    return { collections };
  }

  if (call.action === "authorize-event") {
    if (!call.eventId) fail("An event id is required.");
    const event = await new CollectionEventOutbox(db).get(call.eventId);
    if (!event || event.tenant !== identity.tenant)
      fail("The event is not available in this tenant.", 403);
    await assertLocalCollection(scoped, identity.tenant, event.collection);
    const object = await getObject(scoped, identity.tenant, event.collection);
    if (object.config.studio?.capabilities?.read === false)
      fail("Reading collection events is disabled.", 403);
    const before = event.before
      ? (requireRecordAccess(
          scoped,
          event.collection,
          "read",
          event.before as StudioRecord,
        ),
        project(policy, event.collection, event.before))
      : null;
    const after = event.after
      ? (requireRecordAccess(
          scoped,
          event.collection,
          "read",
          event.after as StudioRecord,
        ),
        project(policy, event.collection, event.after))
      : null;
    const allowed = new Set([
      ...Object.keys(before ?? {}),
      ...Object.keys(after ?? {}),
    ]);
    return {
      authorized: true,
      event: {
        ...event,
        before,
        after,
        changedFields: event.changedFields.filter((field) =>
          allowed.has(field),
        ),
      } satisfies SaviaCollectionEvent,
    };
  }

  if (!call.collection) fail("Select a local collection.");
  const name = call.collection;
  await assertLocalCollection(scoped, identity.tenant, name);
  const object = await getObject(scoped, identity.tenant, name);
  const capability = call.action;
  if (object.config.studio?.capabilities?.[capability as "read"] === false)
    fail("This collection operation is disabled.", 403);
  if (call.action === "list") {
    const page = call.page ?? 1,
      pageSize = call.pageSize ?? 20;
    const filters = Object.entries(call.filters ?? {}).map(
      ([field, value]) => ({ field, op: "eq", value }),
    );
    const { where, args } = buildWhere(
      object,
      identity.tenant,
      filters.length
        ? { filters: JSON.stringify({ logic: "and", conditions: filters }) }
        : {},
      policy,
      dialectFor(db),
    );
    const rows = await scoped
      .prepare(
        `SELECT * FROM studio_records WHERE ${where} ORDER BY id LIMIT ? OFFSET ?`,
      )
      .bind(...args, pageSize, (page - 1) * pageSize)
      .all<any>();
    const total = await scoped
      .prepare(`SELECT count(*) count FROM studio_records WHERE ${where}`)
      .bind(...args)
      .first<{ count: number }>();
    return {
      data: rows.results.map((row) => project(policy, name, parseRecord(row))),
      total: total?.count ?? 0,
      page,
      pageSize,
    };
  }
  if (call.action === "read") {
    if (!call.recordId) fail("A record id is required.");
    return {
      data: project(
        policy,
        name,
        await getRecord(scoped, identity.tenant, name, call.recordId),
      ),
    };
  }

  if (!identity.workflowId || !identity.executionId || !identity.nodeId)
    fail("Native writes require a workflow execution identity.");
  if (
    call.action !== "create" &&
    call.action !== "update" &&
    call.action !== "delete"
  )
    fail("Unsupported collection mutation.");
  const mutationAction = call.action;
  if (call.action !== "create" && !call.version)
    fail("A record version is required.", 428);
  const receiptKey = [
    identity.tenant,
    identity.workflowId,
    identity.executionId,
    identity.nodeId,
  ];
  const fingerprint = await bodyDigest(JSON.stringify(call));
  const cached = async () => {
    const row = await db
      .prepare(
        "SELECT principal_id,fingerprint,response FROM savia_flows_collection_receipts WHERE tenant=? AND workflow_id=? AND execution_id=? AND node_id=?",
      )
      .bind(...receiptKey)
      .first<any>();
    if (!row) return null;
    if (
      row.principal_id !== identity.principalId ||
      row.fingerprint !== fingerprint
    )
      fail("This execution node was already used for another mutation.", 409);
    const receipt = JSON.parse(row.response) as Receipt;
    if (mutationAction === "delete")
      requireRecordAccess(scoped, name, "delete", receipt.before!);
    else
      requireWriteAccess(
        scoped,
        name,
        mutationAction,
        receipt.before,
        receipt.after,
        receipt.fields,
      );
    return {
      data:
        mutationAction === "delete"
          ? receipt.data
          : project(policy, name, receipt.data),
    };
  };
  const replay = await cached();
  if (replay) return replay;
  const cause = call.cause ?? {
    rootEventId: `execution:${identity.executionId}`,
    workflowIds: [],
    depth: 0,
  };
  if (cause.depth >= 8 || cause.workflowIds.length >= 8)
    fail("The collection workflow chain limit was reached.");
  const nextCause = {
    ...cause,
    workflowIds: [...new Set([...cause.workflowIds, identity.workflowId])],
    depth: cause.depth + 1,
  };
  scoped = historyDatabase(scoped, identity.tenant, {
    kind: "workflow",
    id: identity.principalId,
    causeId: JSON.stringify(nextCause),
  });
  let before: StudioRecord | null = null;
  if (call.action !== "create") {
    if (!call.recordId) fail("A record id is required.");
    before = await getRecord(
      scoped,
      identity.tenant,
      name,
      call.recordId,
      call.action,
    );
  }
  const recordReceipt = (data: Record<string, unknown>) => ({
    data,
    before,
    after: data as StudioRecord,
    fields: Object.keys(call.data ?? {}),
  });
  const writtenId =
    call.action === "create" ? crypto.randomUUID() : call.recordId!;
  const checkpoint: RecordCheckpoint<Record<string, unknown>> = {
    before: [
      scoped
        .prepare(
          "INSERT INTO workflow_write_context(workspace_id,record_id,depth,cause) VALUES (?,?,?,?)",
        )
        .bind(
          identity.tenant,
          writtenId,
          nextCause.depth,
          JSON.stringify(nextCause),
        ),
    ],
    after: (record) => [
      scoped
        .prepare(
          "INSERT INTO savia_flows_collection_receipts(tenant,workflow_id,execution_id,node_id,principal_id,fingerprint,response,created_at) VALUES(?,?,?,?,?,?,?,?)",
        )
        .bind(
          ...receiptKey,
          identity.principalId,
          fingerprint,
          JSON.stringify(recordReceipt(record)),
          Date.now(),
        ),
      scoped
        .prepare(
          "DELETE FROM workflow_write_context WHERE workspace_id=? AND record_id=?",
        )
        .bind(identity.tenant, writtenId),
    ],
  };
  try {
    const result =
      call.action === "create"
        ? await createRecord(scoped, identity.tenant, name, call.data ?? {}, {
            id: writtenId,
            checkpoint,
            createdBy: identity.principalId,
          })
        : call.action === "update"
          ? await updateRecord(
              scoped,
              identity.tenant,
              name,
              call.recordId!,
              call.data ?? {},
              { version: call.version!, checkpoint },
            )
          : await deleteRecord(scoped, identity.tenant, name, call.recordId!, {
              version: call.version!,
              checkpoint,
            });
    return {
      data: call.action === "delete" ? result : project(policy, name, result),
    };
  } catch (error) {
    const result = await cached();
    if (result) return result;
    throw error;
  }
}

export function registerSaviaCollectionHostRoutes(
  app: OpenAPIHono,
  db: D1Database,
  options?: SaviaFlowsOptions,
) {
  app.post("/api/public/savia-flows/collections", async (c) => {
    const secret = options?.bridgeSecret?.trim();
    if (!secret || new TextEncoder().encode(secret).length < 32)
      return c.json(
        { error: { message: "Native Savia collections are unavailable." } },
        503,
      );
    const raw = await c.req.text();
    if (new TextEncoder().encode(raw).length > 6 * 1024 * 1024)
      return c.json(
        { error: { message: "Collection request is too large." } },
        413,
      );
    let claims;
    try {
      claims = await verifyCollectionCall(
        c.req.header("authorization")?.replace(/^Bearer /, "") ?? "",
        raw,
        secret,
      );
    } catch {
      return c.json(
        { error: { message: "Invalid native collection authority." } },
        401,
      );
    }
    const parsed = callSchema.safeParse(
      await Promise.resolve()
        .then(() => JSON.parse(raw))
        .catch(() => null),
    );
    if (!parsed.success)
      return c.json(
        { error: { message: "Invalid collection operation." } },
        422,
      );
    const identity: SaviaCollectionIdentity = {
      principalId: claims.sub!,
      tenant: claims.tenant as string,
      workflowId:
        typeof claims.workflowId === "string" ? claims.workflowId : undefined,
      executionId:
        typeof claims.executionId === "string" ? claims.executionId : undefined,
      nodeId: typeof claims.nodeId === "string" ? claims.nodeId : undefined,
    };
    try {
      return c.json(
        await executeNativeCollectionCall(db, identity, parsed.data),
      );
    } catch (error) {
      if (error instanceof HTTPException)
        return c.json({ error: { message: error.message } }, error.status);
      console.error("Native collection operation failed", error);
      return c.json(
        { error: { message: "Native collection storage is unavailable." } },
        503,
      );
    }
  });
}
