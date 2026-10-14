import type { SaviaCollectionEvent } from "@savia/studio-shared/savia-flows";
import { and, eq } from "drizzle-orm";
import type { Bindings } from "../context";
import {
  createDatabase,
  getOrganizationBillingInfo,
  resolveOrganizationBillingOptions,
  saviaCollectionEventBatchGroups,
  saviaCollectionEventBatchItems,
  saviaCollectionTriggers,
  workflows,
} from "../db";
import {
  callSaviaCollections,
  SaviaCollectionHostError,
} from "../nodes/savia/collection-client";
import { WorkflowExecutor } from "./workflow-executor";
import { policyStatus } from "./execution-policy";
import {
  matchesSaviaCollectionSubscription,
  type SaviaCollectionSubscription,
} from "../routes/savia-collection-trigger";
import { WorkflowStore } from "../stores/workflow-store";
import { estimateJsonBytes } from "./resource-limits";

export const SAVIA_COLLECTION_BATCH_WINDOW_SECONDS = 60;
export const MAX_SAVIA_COLLECTION_BATCH_EVENTS = 50;
export const MAX_SAVIA_COLLECTION_BATCH_TRIGGER_BYTES = 1024 * 1024;
export const MAX_SAVIA_COLLECTION_BATCH_RECEIPT_BYTES = 16 * 1024;
export const MAX_PENDING_SAVIA_COLLECTION_EVENTS_PER_ORG = 5_000;
export const SAVIA_COLLECTION_BATCH_MAX_ATTEMPTS = 5;
export const SAVIA_COLLECTION_BATCH_MAX_RETRY_MS = 60 * 60 * 1000;
const BATCH_LEASE_MS = 5 * 60 * 1000;
const RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

export interface CollectionBatchSubscription {
  workflowId: string;
  organizationId: string;
  principalId: string;
  configCreatedAt: Date;
}

export interface EnqueueCollectionBatchResult {
  status: string;
  groupKey?: string;
}

interface BatchGroup {
  group_key: string;
  bucket_key: string;
  workflow_id: string;
  organization_id: string;
  config_created_at: number;
  chunk_index: number;
  attempts: number;
  lease_token: string;
}

interface BatchItem {
  event_id: string;
  workflow_id: string;
  event_json: string;
  execution_id: string | null;
  status: "pending" | "accepted" | "skipped";
}

interface AuthorizedBatchItem {
  sourceId: string;
  workflowId: string;
  event: SaviaCollectionEvent;
  executionId: string | null;
}

/**
 * Persist the source admission, group item, and group receipt in one D1 batch.
 * The item INSERT computes COUNT(bucket)/50 inside the serialized write, so
 * concurrent requests cannot allocate more than fifty items to one chunk.
 */
export async function enqueueSaviaCollectionEventBatch(
  env: Pick<Bindings, "DB">,
  event: SaviaCollectionEvent,
  subscription: CollectionBatchSubscription,
  receivedAt = Date.now(),
): Promise<EnqueueCollectionBatchResult> {
  const configCreatedAt = subscription.configCreatedAt.getTime();
  const receiptMinute = Math.floor(receivedAt / 60_000);
  const bucketKey = await sha256(
    `${subscription.organizationId}\n${subscription.workflowId}\n${configCreatedAt}\n${receiptMinute}`,
  );
  const initialGroupKey = `${bucketKey}:`;
  const executionId = `savia-${(
    await sha256(`${event.id}:${subscription.workflowId}`)
  ).slice(0, 40)}`;
  // Only persist routing metadata. The full event payload is recovered from
  // the host's retained outbox after per-event authorization at flush time.
  const eventJson = JSON.stringify({
    id: event.id,
    tenant: event.tenant,
    collection: event.collection,
    operation: event.operation,
    recordId: event.recordId,
    recordVersion: event.recordVersion,
    timestamp: event.timestamp,
    changedFields: event.changedFields,
    cause: event.cause,
    actor: event.actor,
  });
  if (
    estimateJsonBytes(eventJson, MAX_SAVIA_COLLECTION_BATCH_RECEIPT_BYTES) >
    MAX_SAVIA_COLLECTION_BATCH_RECEIPT_BYTES
  ) {
    return { status: "too-large" };
  }
  const groupDueAt = receivedAt + SAVIA_COLLECTION_BATCH_WINDOW_SECONDS * 1000;

  await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO savia_collection_admissions
        (event_id, workflow_id, execution_id, status, updated_at)
       SELECT ?, ?, ?, 'queued', ?
       WHERE EXISTS (
         SELECT 1 FROM savia_collection_admissions WHERE event_id = ? AND workflow_id = ?
       ) OR (
         SELECT COUNT(*) FROM savia_collection_event_batch_items item
         INNER JOIN savia_collection_event_batch_groups batch
           ON batch.group_key = item.group_key
         WHERE batch.organization_id = ? AND item.status = 'pending'
           AND batch.status IN ('pending', 'processing', 'failed')
       ) < ?`,
    ).bind(
      event.id,
      subscription.workflowId,
      executionId,
      receivedAt,
      event.id,
      subscription.workflowId,
      subscription.organizationId,
      MAX_PENDING_SAVIA_COLLECTION_EVENTS_PER_ORG,
    ),
    env.DB.prepare(
      `INSERT OR IGNORE INTO savia_collection_event_batch_groups
        (group_key, bucket_key, workflow_id, organization_id, config_created_at, chunk_index,
         status, due_at, next_attempt_at, created_at, updated_at)
       SELECT ? || CAST(CAST((SELECT COUNT(*) FROM savia_collection_event_batch_items WHERE bucket_key = ?) / ? AS INTEGER) AS TEXT),
         ?, ?, ?, ?, CAST((SELECT COUNT(*) FROM savia_collection_event_batch_items WHERE bucket_key = ?) / ? AS INTEGER),
         'pending', ?, ?, ?, ?
       WHERE EXISTS (
         SELECT 1 FROM savia_collection_admissions
         WHERE event_id = ? AND workflow_id = ? AND status = 'queued'
       )`,
    ).bind(
      initialGroupKey,
      bucketKey,
      MAX_SAVIA_COLLECTION_BATCH_EVENTS,
      bucketKey,
      subscription.workflowId,
      subscription.organizationId,
      configCreatedAt,
      bucketKey,
      MAX_SAVIA_COLLECTION_BATCH_EVENTS,
      groupDueAt,
      groupDueAt,
      receivedAt,
      receivedAt,
      event.id,
      subscription.workflowId,
    ),
    env.DB.prepare(
      `INSERT OR IGNORE INTO savia_collection_event_batch_items
        (event_id, workflow_id, bucket_key, chunk_index, group_key, event_json, status, created_at, updated_at)
       SELECT ?, ?, ?,
         CAST((SELECT COUNT(*) FROM savia_collection_event_batch_items WHERE bucket_key = ?) / ? AS INTEGER),
         ? || CAST(CAST((SELECT COUNT(*) FROM savia_collection_event_batch_items WHERE bucket_key = ?) / ? AS INTEGER) AS TEXT),
         ?, 'pending', ?, ?
       WHERE EXISTS (
         SELECT 1 FROM savia_collection_admissions
         WHERE event_id = ? AND workflow_id = ? AND status = 'queued'
       )`,
    ).bind(
      event.id,
      subscription.workflowId,
      bucketKey,
      bucketKey,
      MAX_SAVIA_COLLECTION_BATCH_EVENTS,
      initialGroupKey,
      bucketKey,
      MAX_SAVIA_COLLECTION_BATCH_EVENTS,
      eventJson,
      receivedAt,
      receivedAt,
      event.id,
      subscription.workflowId,
    ),
  ]);

  const admission = await env.DB.prepare(
    `SELECT status FROM savia_collection_admissions WHERE event_id = ? AND workflow_id = ?`,
  )
    .bind(event.id, subscription.workflowId)
    .first<{ status: string }>();
  const item = await env.DB.prepare(
    `SELECT group_key FROM savia_collection_event_batch_items WHERE event_id = ? AND workflow_id = ?`,
  )
    .bind(event.id, subscription.workflowId)
    .first<{ group_key: string }>();
  return {
    status: admission?.status ?? "backpressure",
    groupKey: item?.group_key,
  };
}

/** Flush at most one due group. Call from the scheduled worker once per tick. */
export async function flushSaviaCollectionEventBatch(
  env: Bindings,
  options: { now?: number; clock?: () => number } = {},
): Promise<{ skipped: string | false; groupKey?: string }> {
  const startedAt = Date.now();
  const now = options.now ?? startedAt;
  const clock = options.clock ?? (() => now + (Date.now() - startedAt));
  const policy = await policyStatus(env);
  if (!policy.executionsEnabled) return { skipped: "executions-paused" };

  const cleanupTime = clock();
  await env.DB.prepare(
    `UPDATE savia_collection_event_batch_groups
     SET status = 'failed', lease_token = NULL, lease_until = 0,
         last_error = COALESCE(last_error, 'Maximum attempts reached after a worker interruption'),
         finished_at = ?, updated_at = ?
     WHERE status = 'processing' AND lease_until <= ? AND attempts >= ?`,
  )
    .bind(
      cleanupTime,
      cleanupTime,
      cleanupTime,
      SAVIA_COLLECTION_BATCH_MAX_ATTEMPTS,
    )
    .run();

  const leaseToken = crypto.randomUUID();
  const claimTime = clock();
  const claimed = await env.DB.prepare(
    `UPDATE savia_collection_event_batch_groups
     SET status = 'processing', attempts = attempts + 1, lease_token = ?,
         lease_until = ?, updated_at = ?
     WHERE group_key = (
       SELECT group_key FROM savia_collection_event_batch_groups
       WHERE attempts < ? AND (
         (status = 'pending' AND due_at <= ? AND next_attempt_at <= ?)
         OR (status = 'processing' AND lease_until <= ?)
       )
       ORDER BY due_at, created_at, group_key LIMIT 1
     )
     RETURNING group_key, bucket_key, workflow_id, organization_id,
       config_created_at, chunk_index, attempts, lease_token`,
  )
    .bind(
      leaseToken,
      claimTime + BATCH_LEASE_MS,
      claimTime,
      SAVIA_COLLECTION_BATCH_MAX_ATTEMPTS,
      claimTime,
      claimTime,
      claimTime,
    )
    .first<BatchGroup>();
  if (!claimed) return { skipped: "no-due-group" };

  try {
    await flushClaimedGroup(env, claimed, clock);
    return { skipped: false, groupKey: claimed.group_key };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const currentTime = clock();
    const deferWithoutCounting = isDeferredAdmissionFailure(error);
    const terminal =
      claimed.attempts >= SAVIA_COLLECTION_BATCH_MAX_ATTEMPTS &&
      !deferWithoutCounting;
    const retryDelay = deferWithoutCounting
      ? SAVIA_COLLECTION_BATCH_MAX_RETRY_MS
      : Math.min(
          SAVIA_COLLECTION_BATCH_MAX_RETRY_MS,
          15_000 * 2 ** Math.max(0, claimed.attempts - 1),
        );
    await env.DB.prepare(
      `UPDATE savia_collection_event_batch_groups
       SET status = ?, attempts = CASE WHEN ? THEN MAX(attempts - 1, 0) ELSE attempts END,
           next_attempt_at = ?, lease_token = NULL, lease_until = 0,
           last_error = ?, finished_at = ?, updated_at = ?
       WHERE group_key = ? AND status = 'processing' AND lease_token = ?
         AND lease_until > ?`,
    )
      .bind(
        terminal ? "failed" : "pending",
        deferWithoutCounting ? 1 : 0,
        terminal ? currentTime : currentTime + retryDelay,
        message.slice(0, 1000),
        terminal ? currentTime : null,
        currentTime,
        claimed.group_key,
        claimed.lease_token,
        currentTime,
      )
      .run();
    console.error(
      terminal
        ? "Savia collection event batch permanently failed"
        : deferWithoutCounting
          ? "Savia collection event batch deferred by execution policy"
          : "Savia collection event batch will retry",
      {
        groupKey: claimed.group_key,
        attempts: deferWithoutCounting
          ? Math.max(0, claimed.attempts - 1)
          : claimed.attempts,
        deferred: deferWithoutCounting,
        error: message,
      },
    );
    return {
      skipped: terminal ? "max-attempts" : "retry-scheduled",
      groupKey: claimed.group_key,
    };
  }
}

async function flushClaimedGroup(
  env: Bindings,
  group: BatchGroup,
  clock: () => number,
): Promise<void> {
  const db = createDatabase(env.DB);
  const [subscription] = await db
    .select({
      workflowId: saviaCollectionTriggers.workflowId,
      organizationId: saviaCollectionTriggers.organizationId,
      principalId: saviaCollectionTriggers.principalId,
      config: saviaCollectionTriggers.config,
      createdAt: saviaCollectionTriggers.createdAt,
      active: saviaCollectionTriggers.active,
      enabled: workflows.enabled,
      workflowTrigger: workflows.trigger,
    })
    .from(saviaCollectionTriggers)
    .innerJoin(workflows, eq(saviaCollectionTriggers.workflowId, workflows.id))
    .where(
      and(
        eq(saviaCollectionTriggers.workflowId, group.workflow_id),
        eq(saviaCollectionTriggers.organizationId, group.organization_id),
      ),
    )
    .limit(1);

  if (
    !subscription?.active ||
    !subscription.enabled ||
    subscription.workflowTrigger !== "savia_collection_event"
  ) {
    await finishGroupAsSkipped(env, group, clock, "Subscription is disabled");
    return;
  }

  const config = JSON.parse(subscription.config) as SaviaCollectionSubscription;
  if (
    (config.batchWindowSeconds ?? 0) !==
      SAVIA_COLLECTION_BATCH_WINDOW_SECONDS ||
    subscription.createdAt.getTime() !== group.config_created_at
  ) {
    await finishGroupAsSkipped(
      env,
      group,
      clock,
      "Batch subscription configuration changed",
    );
    return;
  }

  const store = new WorkflowStore(env);
  const saved = await store.getWithData(
    group.workflow_id,
    group.organization_id,
  );
  if (
    !saved?.enabled ||
    saved.data.trigger !== "savia_collection_event" ||
    !saved.data.nodes.some((node) => node.type === "savia-collection-event")
  ) {
    await finishGroupAsSkipped(
      env,
      group,
      clock,
      "Workflow is no longer enabled",
    );
    return;
  }

  const groupItems = await env.DB.prepare(
    `SELECT event_id, workflow_id, event_json, execution_id, status
     FROM savia_collection_event_batch_items
     WHERE group_key = ?
     ORDER BY created_at, event_id`,
  )
    .bind(group.group_key)
    .all<BatchItem>();
  const items = groupItems.results.filter((item) => item.status === "pending");
  const batchCause = createBatchCause(groupItems.results, group.group_key);

  const authorized: AuthorizedBatchItem[] = [];
  for (const item of items) {
    const sourceEvent = JSON.parse(item.event_json) as SaviaCollectionEvent;
    if (
      Date.parse(sourceEvent.timestamp) < subscription.createdAt.getTime() ||
      !matchesSaviaCollectionSource(sourceEvent, config)
    ) {
      await markBatchItem(
        env,
        item.event_id,
        item.workflow_id,
        "skipped",
        group,
        clock,
      );
      continue;
    }

    let projected: SaviaCollectionEvent;
    try {
      const result = await callSaviaCollections<{
        event: SaviaCollectionEvent;
        authorized: true;
      }>(
        env,
        { action: "authorize-event", eventId: sourceEvent.id },
        {
          principalId: subscription.principalId,
          tenant: group.organization_id,
          workflowId: group.workflow_id,
        },
      );
      projected = result.event;
      if (!result.authorized || !projected) {
        await markBatchItem(
          env,
          item.event_id,
          item.workflow_id,
          "skipped",
          group,
          clock,
        );
        continue;
      }
    } catch (error) {
      if (isTerminalAuthorizationSkip(error)) {
        await markBatchItem(
          env,
          item.event_id,
          item.workflow_id,
          "skipped",
          group,
          clock,
        );
        continue;
      }
      throw error;
    }

    if (
      !matchesSaviaCollectionSubscription(
        projected,
        config,
        group.organization_id,
        group.workflow_id,
      )
    ) {
      await markBatchItem(
        env,
        item.event_id,
        item.workflow_id,
        "skipped",
        group,
        clock,
      );
      continue;
    }
    authorized.push({
      sourceId: item.event_id,
      workflowId: item.workflow_id,
      event: projected,
      executionId: item.execution_id,
    });
  }

  // Authorization can take long enough for a manager to rotate or disable
  // the subscription. Re-read it before creating any child execution, and
  // reauthorize each event if the saved principal changed in the meantime.
  const [currentSubscription] = await db
    .select({
      principalId: saviaCollectionTriggers.principalId,
      config: saviaCollectionTriggers.config,
      createdAt: saviaCollectionTriggers.createdAt,
      active: saviaCollectionTriggers.active,
      enabled: workflows.enabled,
      workflowTrigger: workflows.trigger,
    })
    .from(saviaCollectionTriggers)
    .innerJoin(workflows, eq(saviaCollectionTriggers.workflowId, workflows.id))
    .where(
      and(
        eq(saviaCollectionTriggers.workflowId, group.workflow_id),
        eq(saviaCollectionTriggers.organizationId, group.organization_id),
        eq(saviaCollectionTriggers.active, true),
      ),
    )
    .limit(1);
  if (
    !currentSubscription?.active ||
    !currentSubscription.enabled ||
    currentSubscription.workflowTrigger !== "savia_collection_event" ||
    currentSubscription.createdAt.getTime() !== group.config_created_at
  ) {
    await finishGroupAsSkipped(
      env,
      group,
      clock,
      "Batch subscription changed during source authorization",
    );
    return;
  }
  const currentConfig = JSON.parse(
    currentSubscription.config,
  ) as SaviaCollectionSubscription;
  if ((currentConfig.batchWindowSeconds ?? 0) !== 60) {
    await finishGroupAsSkipped(
      env,
      group,
      clock,
      "Batching was disabled during source authorization",
    );
    return;
  }
  for (let index = authorized.length - 1; index >= 0; index -= 1) {
    const item = authorized[index];
    if (
      !matchesSaviaCollectionSubscription(
        item.event,
        currentConfig,
        group.organization_id,
        group.workflow_id,
      )
    ) {
      await markBatchItem(
        env,
        item.sourceId,
        item.workflowId,
        "skipped",
        group,
        clock,
      );
      authorized.splice(index, 1);
    }
  }
  if (currentSubscription.principalId !== subscription.principalId) {
    const skippedIds = new Set<string>();
    for (const item of authorized) {
      try {
        const result = await callSaviaCollections<{
          event: SaviaCollectionEvent;
          authorized: true;
        }>(
          env,
          { action: "authorize-event", eventId: item.sourceId },
          {
            principalId: currentSubscription.principalId,
            tenant: group.organization_id,
            workflowId: group.workflow_id,
          },
        );
        if (
          !result.authorized ||
          !result.event ||
          !matchesSaviaCollectionSubscription(
            result.event,
            currentConfig,
            group.organization_id,
            group.workflow_id,
          )
        ) {
          await markBatchItem(
            env,
            item.sourceId,
            item.workflowId,
            "skipped",
            group,
            clock,
          );
          skippedIds.add(item.sourceId);
          continue;
        }
        item.event = result.event;
      } catch (error) {
        if (!isTerminalAuthorizationSkip(error)) throw error;
        await markBatchItem(
          env,
          item.sourceId,
          item.workflowId,
          "skipped",
          group,
          clock,
        );
        skippedIds.add(item.sourceId);
      }
    }
    for (let index = authorized.length - 1; index >= 0; index -= 1) {
      if (skippedIds.has(authorized[index].sourceId))
        authorized.splice(index, 1);
    }
  }

  const billingInfo = await getOrganizationBillingInfo(
    db,
    group.organization_id,
  );
  if (!billingInfo) throw new Error("Organization billing info is unavailable");
  const fixedChunks = new Map<string, AuthorizedBatchItem[]>();
  const unassigned: AuthorizedBatchItem[] = [];
  for (const item of authorized) {
    if (!item.executionId) {
      unassigned.push(item);
      continue;
    }
    const chunk = fixedChunks.get(item.executionId) ?? [];
    chunk.push(item);
    fixedChunks.set(item.executionId, chunk);
  }
  const dispatchChunks: Array<{
    executionId: string;
    events: AuthorizedBatchItem[];
  }> = [...fixedChunks].map(([executionId, events]) => ({
    executionId,
    events: applyBatchCause(events, batchCause),
  }));
  for (const chunk of packAuthorizedEvents(unassigned, batchCause)) {
    const executionId = `savia-${(
      await sha256(
        `${group.workflow_id}:${chunk.map((item) => item.sourceId).join("\n")}`,
      )
    ).slice(0, 40)}`;
    await persistExecutionAssignment(env, group, chunk, executionId, clock);
    dispatchChunks.push({ executionId, events: chunk });
  }

  for (const chunk of dispatchChunks) {
    const policy = await policyStatus(env);
    if (!policy.executionsEnabled)
      throw new Error("Workflow executions are paused");
    await renewBatchLease(env, group, clock());
    const started = await WorkflowExecutor.execute({
      workflow: saved.data,
      userId: currentSubscription.principalId,
      organizationId: group.organization_id,
      ...resolveOrganizationBillingOptions(billingInfo),
      saviaCollectionEvent: chunk.events[0].event,
      saviaCollectionEvents: chunk.events.map((item) => item.event),
      executionId: chunk.executionId,
      env,
    });
    if (isQuotaOrAuthorizationFailure(started.execution.error)) {
      throw new Error(started.execution.error);
    }
    for (const item of chunk.events) {
      await markBatchItem(
        env,
        item.sourceId,
        item.workflowId,
        "accepted",
        group,
        clock,
      );
    }
  }

  const pending = await env.DB.prepare(
    `SELECT COUNT(*) AS count FROM savia_collection_event_batch_items WHERE group_key = ? AND status = 'pending'`,
  )
    .bind(group.group_key)
    .first<{ count: number }>();
  if ((pending?.count ?? 0) > 0) {
    throw new Error("Collection event batch still has pending items");
  }
  const finishedAt = clock();
  const finished = await env.DB.prepare(
    `UPDATE savia_collection_event_batch_groups
     SET status = 'completed', lease_token = NULL, lease_until = 0,
         last_error = NULL, finished_at = ?, updated_at = ?
     WHERE group_key = ? AND status = 'processing' AND lease_token = ?
       AND lease_until > ?`,
  )
    .bind(
      finishedAt,
      finishedAt,
      group.group_key,
      group.lease_token,
      finishedAt,
    )
    .run();
  if ((finished.meta?.changes ?? 0) === 0)
    throw new Error("Batch lease expired before completion");
}

function packAuthorizedEvents(
  items: AuthorizedBatchItem[],
  batchCause: NonNullable<SaviaCollectionEvent["cause"]>,
): AuthorizedBatchItem[][] {
  const chunks: AuthorizedBatchItem[][] = [];
  let current: AuthorizedBatchItem[] = [];

  const fitsTrigger = (candidate: typeof current): boolean => {
    const primary = { ...candidate[0].event, cause: batchCause };
    const events = [primary, ...candidate.slice(1).map((item) => item.event)];
    return (
      estimateJsonBytes(
        { saviaCollectionEvent: primary, saviaCollectionEvents: events },
        MAX_SAVIA_COLLECTION_BATCH_TRIGGER_BYTES,
      ) <= MAX_SAVIA_COLLECTION_BATCH_TRIGGER_BYTES
    );
  };

  for (const item of items) {
    if (
      current.length >= MAX_SAVIA_COLLECTION_BATCH_EVENTS ||
      (current.length > 0 && !fitsTrigger([...current, item]))
    ) {
      chunks.push(current);
      current = [];
    }
    current.push(item);
    if (!fitsTrigger(current)) {
      throw new Error(
        "A projected collection event exceeds the batch trigger size limit",
      );
    }
  }
  if (current.length) chunks.push(current);
  return chunks.map((chunk) => {
    return applyBatchCause(chunk, batchCause);
  });
}

function applyBatchCause(
  items: AuthorizedBatchItem[],
  batchCause: NonNullable<SaviaCollectionEvent["cause"]>,
): AuthorizedBatchItem[] {
  if (items.length === 0) return items;
  const primary = { ...items[0].event, cause: batchCause };
  const chunk = [{ ...items[0], event: primary }, ...items.slice(1)];
  if (
    items.length > MAX_SAVIA_COLLECTION_BATCH_EVENTS ||
    estimateJsonBytes(
      {
        saviaCollectionEvent: primary,
        saviaCollectionEvents: chunk.map((item) => item.event),
      },
      MAX_SAVIA_COLLECTION_BATCH_TRIGGER_BYTES,
    ) > MAX_SAVIA_COLLECTION_BATCH_TRIGGER_BYTES
  ) {
    throw new Error(
      "An assigned collection event batch exceeds the trigger size limit",
    );
  }
  return chunk;
}

function createBatchCause(
  items: BatchItem[],
  groupKey: string,
): {
  rootEventId: string;
  workflowIds: string[];
  depth: number;
} {
  const workflowIds = new Set<string>();
  let depth = 0;
  for (const item of items) {
    const event = JSON.parse(item.event_json) as SaviaCollectionEvent;
    for (const workflowId of event.cause?.workflowIds ?? []) {
      workflowIds.add(workflowId);
    }
    depth = Math.max(depth, event.cause?.depth ?? 0);
  }
  return { rootEventId: groupKey, workflowIds: [...workflowIds], depth };
}

async function persistExecutionAssignment(
  env: Pick<Bindings, "DB">,
  group: BatchGroup,
  items: AuthorizedBatchItem[],
  executionId: string,
  clock: () => number,
): Promise<void> {
  if (items.length === 0) return;
  const now = clock();
  await env.DB.batch(
    items.map((item) =>
      env.DB.prepare(
        `UPDATE savia_collection_event_batch_items
         SET execution_id = ?, updated_at = ?
         WHERE event_id = ? AND workflow_id = ? AND group_key = ?
           AND status = 'pending' AND execution_id IS NULL
           AND EXISTS (
             SELECT 1 FROM savia_collection_event_batch_groups batch
             WHERE batch.group_key = ? AND batch.status = 'processing'
               AND batch.lease_token = ? AND batch.lease_until > ?
           )`,
      ).bind(
        executionId,
        now,
        item.sourceId,
        item.workflowId,
        group.group_key,
        group.group_key,
        group.lease_token,
        now,
      ),
    ),
  );
  const assigned = await env.DB.prepare(
    `SELECT event_id, execution_id FROM savia_collection_event_batch_items
     WHERE group_key = ? AND event_id IN (${items.map(() => "?").join(",")})`,
  )
    .bind(group.group_key, ...items.map((item) => item.sourceId))
    .all<{ event_id: string; execution_id: string | null }>();
  if (
    assigned.results.length !== items.length ||
    assigned.results.some((item) => item.execution_id !== executionId)
  ) {
    throw new Error("Batch lease expired before execution assignment");
  }
  await assertActiveBatchLease(env, group, clock());
  for (const item of items) item.executionId = executionId;
}

async function assertActiveBatchLease(
  env: Pick<Bindings, "DB">,
  group: BatchGroup,
  now = Date.now(),
): Promise<void> {
  const lease = await env.DB.prepare(
    `SELECT 1 AS active FROM savia_collection_event_batch_groups
     WHERE group_key = ? AND status = 'processing' AND lease_token = ?
       AND lease_until > ?`,
  )
    .bind(group.group_key, group.lease_token, now)
    .first<{ active: number }>();
  if (!lease) throw new Error("Batch lease expired before execution dispatch");
}

async function renewBatchLease(
  env: Pick<Bindings, "DB">,
  group: BatchGroup,
  now: number,
): Promise<void> {
  const renewed = await env.DB.prepare(
    `UPDATE savia_collection_event_batch_groups
     SET lease_until = ?, updated_at = ?
     WHERE group_key = ? AND status = 'processing' AND lease_token = ?
       AND lease_until > ?
     RETURNING group_key`,
  )
    .bind(now + BATCH_LEASE_MS, now, group.group_key, group.lease_token, now)
    .first<{ group_key: string }>();
  if (!renewed)
    throw new Error("Batch lease expired before execution dispatch");
}

async function markBatchItem(
  env: Pick<Bindings, "DB">,
  eventId: string,
  workflowId: string,
  status: "accepted" | "skipped",
  group: BatchGroup,
  clock: () => number,
): Promise<void> {
  const now = clock();
  const results = await env.DB.batch([
    env.DB.prepare(
      `UPDATE savia_collection_event_batch_items SET status = ?, updated_at = ?, finished_at = ?
       WHERE event_id = ? AND workflow_id = ? AND group_key = ? AND status = 'pending'
         AND EXISTS (
           SELECT 1 FROM savia_collection_event_batch_groups batch
           WHERE batch.group_key = ? AND batch.status = 'processing'
             AND batch.lease_token = ? AND batch.lease_until > ?
         )`,
    ).bind(
      status,
      now,
      now,
      eventId,
      workflowId,
      group.group_key,
      group.group_key,
      group.lease_token,
      now,
    ),
    env.DB.prepare(
      `UPDATE savia_collection_admissions SET status = ?, updated_at = ?
       WHERE event_id = ? AND workflow_id = ? AND status = 'queued'
         AND EXISTS (
           SELECT 1 FROM savia_collection_event_batch_groups batch
           WHERE batch.group_key = ? AND batch.status = 'processing'
             AND batch.lease_token = ? AND batch.lease_until > ?
         )`,
    ).bind(
      status,
      now,
      eventId,
      workflowId,
      group.group_key,
      group.lease_token,
      now,
    ),
  ]);
  if ((results[0]?.meta?.changes ?? 0) === 0)
    throw new Error("Batch lease expired before item update");
}

async function finishGroupAsSkipped(
  env: Pick<Bindings, "DB">,
  group: BatchGroup,
  clock: () => number,
  reason: string,
): Promise<void> {
  const now = clock();
  const results = await env.DB.batch([
    env.DB.prepare(
      `UPDATE savia_collection_event_batch_items SET status = 'skipped', updated_at = ?, finished_at = ?
       WHERE group_key = ? AND status = 'pending' AND EXISTS (
         SELECT 1 FROM savia_collection_event_batch_groups batch
         WHERE batch.group_key = ? AND batch.status = 'processing'
           AND batch.lease_token = ? AND batch.lease_until > ?
       )`,
    ).bind(now, now, group.group_key, group.group_key, group.lease_token, now),
    env.DB.prepare(
      `UPDATE savia_collection_admissions SET status = 'skipped', updated_at = ?
       WHERE workflow_id = ? AND event_id IN (
         SELECT event_id FROM savia_collection_event_batch_items WHERE group_key = ?
       ) AND status = 'queued' AND EXISTS (
         SELECT 1 FROM savia_collection_event_batch_groups batch
         WHERE batch.group_key = ? AND batch.status = 'processing'
           AND batch.lease_token = ? AND batch.lease_until > ?
       )`,
    ).bind(
      now,
      group.workflow_id,
      group.group_key,
      group.group_key,
      group.lease_token,
      now,
    ),
    env.DB.prepare(
      `UPDATE savia_collection_event_batch_groups
       SET status = 'completed', last_error = ?, lease_token = NULL, lease_until = 0,
           finished_at = ?, updated_at = ? WHERE group_key = ? AND status = 'processing'
             AND lease_token = ? AND lease_until > ?`,
    ).bind(reason, now, now, group.group_key, group.lease_token, now),
  ]);
  if ((results[2]?.meta?.changes ?? 0) === 0)
    throw new Error("Batch lease expired before skip completion");
}

function isTerminalAuthorizationSkip(error: unknown): boolean {
  return (
    error instanceof SaviaCollectionHostError &&
    [403, 404, 422].includes(error.status)
  );
}

function isQuotaOrAuthorizationFailure(
  error: string | null | undefined,
): boolean {
  return Boolean(
    error &&
    /(?:workflow executions are paused|insufficient compute credits|compute credit.{0,40}limit|(?:daily|monthly|concurrent) execution limit reached|forbidden|access denied|\b(?:403|404|422)\b)/i.test(
      error,
    ),
  );
}

/** Pauses and expected account admission limits should never exhaust retries. */
function isDeferredAdmissionFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /(?:workflow executions are paused|insufficient compute credits|(?:daily|monthly|concurrent) execution limit reached|(?:compute )?credit.{0,40}(?:limit|pause|exceed|unavailable)|(?:limit|pause|exceed).{0,40}(?:compute )?credit)/i.test(
    message,
  );
}

function matchesSaviaCollectionSource(
  event: SaviaCollectionEvent,
  subscription: SaviaCollectionSubscription,
): boolean {
  return (
    event.collection === subscription.collection &&
    subscription.operations.includes(event.operation)
  );
}

/** Delete only finished source receipts older than ninety days. */
export async function purgeSaviaCollectionEventBatchReceipts(
  env: Pick<Bindings, "DB">,
  options: { now?: number; limit?: number } = {},
): Promise<number> {
  const now = options.now ?? Date.now();
  const cutoff = now - RETENTION_MS;
  const limit = Math.max(1, Math.min(1000, options.limit ?? 250));
  const result = await env.DB.prepare(
    `DELETE FROM savia_collection_event_batch_items
     WHERE rowid IN (
       SELECT rowid FROM savia_collection_event_batch_items
       WHERE finished_at IS NOT NULL AND finished_at <= ?
       ORDER BY finished_at, event_id LIMIT ?
     )`,
  )
    .bind(cutoff, limit)
    .run();
  await env.DB.prepare(
    `DELETE FROM savia_collection_event_batch_groups
     WHERE group_key IN (
       SELECT batch.group_key FROM savia_collection_event_batch_groups batch
       WHERE batch.finished_at IS NOT NULL AND batch.finished_at <= ?
         AND NOT EXISTS (
           SELECT 1 FROM savia_collection_event_batch_items item
           WHERE item.group_key = batch.group_key
         )
       ORDER BY batch.finished_at, batch.group_key LIMIT ?
     )`,
  )
    .bind(cutoff, limit)
    .run();
  return result.meta.changes ?? 0;
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
