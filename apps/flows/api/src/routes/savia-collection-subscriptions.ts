import { and, count, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { jwtMiddleware } from "../auth";
import type { ApiContext } from "../context";
import {
  createDatabase,
  saviaCollectionEventBatchGroups,
  saviaCollectionTriggers,
  workflows,
} from "../db";
import { callSaviaCollections } from "../nodes/savia/collection-client";
import { WorkflowStore } from "../stores/workflow-store";
import { getAuthContext } from "../utils/auth-context";

const operation = z.enum(["created", "updated", "deleted", "restored"]);
const condition = z
  .object({
    field: z.string().min(1).max(128),
    source: z.enum(["before", "after"]),
    equals: z.unknown(),
  })
  .refine((value) => Object.hasOwn(value, "equals"), "equals is required");
const configSchema = z.object({
  collection: z.string().min(1).max(128),
  operations: z.array(operation).min(1).max(4),
  watchedFields: z.array(z.string().min(1).max(128)).max(128).optional(),
  conditions: z.array(condition).max(32).optional(),
  ignoreOwnChanges: z.literal(true),
  batchWindowSeconds: z.union([z.literal(0), z.literal(60)]).default(0),
});

export const saviaCollectionSubscriptionRoutes = new Hono<ApiContext>();

saviaCollectionSubscriptionRoutes.get(
  "/:workflowId/savia-trigger",
  jwtMiddleware,
  async (c) => {
    const { organizationId, userId, isApiKey } = getAuthContext(c);
    const workflowId = c.req.param("workflowId") ?? "";
    const db = createDatabase(c.env.DB);
    const [workflow] = await db
      .select({ id: workflows.id })
      .from(workflows)
      .where(
        and(
          eq(workflows.id, workflowId),
          eq(workflows.organizationId, organizationId),
        ),
      )
      .limit(1);
    if (!workflow) return c.json({ error: "Workflow not found" }, 404);
    const [subscription] = await db
      .select()
      .from(saviaCollectionTriggers)
      .where(eq(saviaCollectionTriggers.workflowId, workflowId))
      .limit(1);
    const config = subscription
      ? (JSON.parse(subscription.config) as z.infer<typeof configSchema>)
      : null;
    const batchCounts = await db
      .select({
        status: saviaCollectionEventBatchGroups.status,
        count: count(),
      })
      .from(saviaCollectionEventBatchGroups)
      .where(
        and(
          eq(saviaCollectionEventBatchGroups.workflowId, workflowId),
          eq(saviaCollectionEventBatchGroups.organizationId, organizationId),
        ),
      )
      .groupBy(saviaCollectionEventBatchGroups.status);
    return c.json({
      enabled: Boolean(subscription?.active),
      configuredBy: subscription?.principalId === userId ? "you" : undefined,
      config: config
        ? { ...config, batchWindowSeconds: config.batchWindowSeconds ?? 0 }
        : null,
      batches: {
        pending: batchCounts
          .filter((item) => ["pending", "processing"].includes(item.status))
          .reduce((total, item) => total + item.count, 0),
        failed:
          batchCounts.find((item) => item.status === "failed")?.count ?? 0,
      },
    });
  },
);

saviaCollectionSubscriptionRoutes.put(
  "/:workflowId/savia-trigger",
  jwtMiddleware,
  async (c) => {
    const payload = c.get("jwtPayload");
    const role = payload?.organization?.role ?? payload?.role;
    if (!payload || !["admin", "owner"].includes(role ?? "")) {
      return c.json(
        {
          error: "Only organization managers can configure collection triggers",
        },
        403,
      );
    }
    const { organizationId, userId, isApiKey } = getAuthContext(c);
    if (isApiKey) return c.json({ error: "A user session is required" }, 403);
    const parsed = configSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success)
      return c.json(
        {
          error: "Invalid collection trigger configuration",
          details: parsed.error.issues,
        },
        400,
      );

    const workflowId = c.req.param("workflowId") ?? "";
    const store = new WorkflowStore(c.env);
    const saved = await store.getWithData(workflowId, organizationId);
    if (!saved) return c.json({ error: "Workflow not found" }, 404);
    if (
      saved.data.trigger !== "savia_collection_event" ||
      !saved.data.nodes.some((node) => node.type === "savia-collection-event")
    ) {
      return c.json(
        {
          error:
            "Save a Savia Collection Event trigger node before enabling this subscription",
        },
        409,
      );
    }

    let catalog: {
      collections: Array<{
        name: string;
        capabilities: { read?: boolean };
        fields: Array<{ name: string }>;
      }>;
    };
    try {
      catalog = await callSaviaCollections(
        c.env,
        { action: "catalog" },
        {
          principalId: userId,
          tenant: organizationId,
        },
      );
    } catch (error) {
      return c.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Collection catalog unavailable",
        },
        503,
      );
    }
    const collection = catalog.collections.find(
      (item) => item.name === parsed.data.collection,
    );
    if (!collection)
      return c.json(
        { error: "This collection is unavailable to the configuring user" },
        403,
      );
    if (!collection.capabilities?.read)
      return c.json(
        { error: "Collection event subscriptions require read access" },
        403,
      );
    const availableFields = new Set(
      collection.fields.map((field) => field.name),
    );
    if (
      [
        ...(parsed.data.watchedFields ?? []),
        ...(parsed.data.conditions ?? []).map((item) => item.field),
      ].some((field) => !availableFields.has(field))
    ) {
      return c.json(
        {
          error:
            "Trigger fields must come from the selected collection's accessible field catalog",
        },
        400,
      );
    }

    const db = createDatabase(c.env.DB);
    const now = new Date();
    await db
      .insert(saviaCollectionTriggers)
      .values({
        workflowId,
        organizationId,
        principalId: userId,
        config: JSON.stringify(parsed.data),
        active: true,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: saviaCollectionTriggers.workflowId,
        set: {
          organizationId,
          principalId: userId,
          config: JSON.stringify(parsed.data),
          active: true,
          createdAt: now,
          updatedAt: now,
        },
      });
    return c.json({ enabled: true, config: parsed.data }, 200);
  },
);

saviaCollectionSubscriptionRoutes.delete(
  "/:workflowId/savia-trigger",
  jwtMiddleware,
  async (c) => {
    const payload = c.get("jwtPayload");
    const role = payload?.organization?.role ?? payload?.role;
    if (!payload || !["admin", "owner"].includes(role ?? "")) {
      return c.json(
        {
          error: "Only organization managers can configure collection triggers",
        },
        403,
      );
    }
    const { organizationId } = getAuthContext(c);
    const workflowId = c.req.param("workflowId") ?? "";
    const db = createDatabase(c.env.DB);
    const [workflow] = await db
      .select({ id: workflows.id })
      .from(workflows)
      .where(
        and(
          eq(workflows.id, workflowId),
          eq(workflows.organizationId, organizationId),
        ),
      )
      .limit(1);
    if (!workflow) return c.json({ error: "Workflow not found" }, 404);
    await db
      .delete(saviaCollectionTriggers)
      .where(eq(saviaCollectionTriggers.workflowId, workflowId));
    return c.json({ enabled: false });
  },
);

saviaCollectionSubscriptionRoutes.post(
  "/:workflowId/savia-trigger/batches/retry",
  jwtMiddleware,
  async (c) => {
    const payload = c.get("jwtPayload");
    const role = payload?.organization?.role ?? payload?.role;
    if (!payload || !["admin", "owner"].includes(role ?? "")) {
      return c.json(
        {
          error: "Only organization managers can retry collection batches",
        },
        403,
      );
    }
    const { organizationId, isApiKey } = getAuthContext(c);
    if (isApiKey) return c.json({ error: "A user session is required" }, 403);
    if (payload.organization?.id !== organizationId) {
      return c.json(
        { error: "Manager access is required for this organization" },
        403,
      );
    }
    const workflowId = c.req.param("workflowId") ?? "";
    const db = createDatabase(c.env.DB);
    const [workflow] = await db
      .select({ id: workflows.id })
      .from(workflows)
      .where(
        and(
          eq(workflows.id, workflowId),
          eq(workflows.organizationId, organizationId),
        ),
      )
      .limit(1);
    if (!workflow) return c.json({ error: "Workflow not found" }, 404);

    const [subscription] = await db
      .select({
        active: saviaCollectionTriggers.active,
        config: saviaCollectionTriggers.config,
        createdAt: saviaCollectionTriggers.createdAt,
      })
      .from(saviaCollectionTriggers)
      .where(
        and(
          eq(saviaCollectionTriggers.workflowId, workflowId),
          eq(saviaCollectionTriggers.organizationId, organizationId),
        ),
      )
      .limit(1);
    if (!subscription?.active) {
      return c.json({ error: "The collection trigger is not active" }, 409);
    }
    let currentConfig: z.infer<typeof configSchema>;
    try {
      currentConfig = configSchema.parse(JSON.parse(subscription.config));
    } catch {
      return c.json(
        { error: "The collection trigger configuration is invalid" },
        409,
      );
    }
    if (currentConfig.batchWindowSeconds !== 60) {
      return c.json(
        { error: "Batch retry requires batching to remain enabled" },
        409,
      );
    }

    const now = new Date();
    const failedGroups = await db
      .select({ groupKey: saviaCollectionEventBatchGroups.groupKey })
      .from(saviaCollectionEventBatchGroups)
      .where(
        and(
          eq(saviaCollectionEventBatchGroups.workflowId, workflowId),
          eq(saviaCollectionEventBatchGroups.organizationId, organizationId),
          eq(saviaCollectionEventBatchGroups.status, "failed"),
          eq(
            saviaCollectionEventBatchGroups.configCreatedAt,
            subscription.createdAt.getTime(),
          ),
        ),
      )
      .orderBy(saviaCollectionEventBatchGroups.finishedAt)
      .limit(250);
    if (failedGroups.length === 0) return c.json({ retried: 0 });
    const retried = await db
      .update(saviaCollectionEventBatchGroups)
      .set({
        status: "pending",
        attempts: 0,
        dueAt: now.getTime(),
        nextAttemptAt: now.getTime(),
        leaseToken: null,
        leaseUntil: 0,
        lastError: null,
        finishedAt: null,
        updatedAt: now.getTime(),
      })
      .where(
        and(
          eq(saviaCollectionEventBatchGroups.workflowId, workflowId),
          eq(saviaCollectionEventBatchGroups.organizationId, organizationId),
          eq(saviaCollectionEventBatchGroups.status, "failed"),
          eq(
            saviaCollectionEventBatchGroups.configCreatedAt,
            subscription.createdAt.getTime(),
          ),
          inArray(
            saviaCollectionEventBatchGroups.groupKey,
            failedGroups.map((group) => group.groupKey),
          ),
        ),
      )
      .returning({ groupKey: saviaCollectionEventBatchGroups.groupKey });
    return c.json({ retried: retried.length });
  },
);
