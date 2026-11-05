import CronParser from "cron-parser";

import type { Bindings } from "./context";
import {
  createDatabase,
  getActiveScheduledTriggers,
  resolveOrganizationBillingOptions,
} from "./db";
import { flushSaviaCollectionEventBatch } from "./services/collection-event-batches";
import { maintainFinishedCostReceipts } from "./services/cost-ledger-retention";
import { policyStatus } from "./services/execution-policy";
import { maintainLocalExecutionHistory } from "./services/execution-retention";
import { WorkflowExecutor } from "./services/workflow-executor";
import {
  claimScheduledTriggerOccurrence,
  completeScheduledTriggerOccurrence,
  listExpiredScheduledTriggerOccurrences,
  markScheduledTriggerOccurrenceDispatched,
  pruneCompletedScheduledTriggerOccurrences,
  renewScheduledTriggerOccurrenceLease,
  releaseScheduledTriggerOccurrence,
} from "./services/scheduled-trigger-claims";
import { WorkflowStore } from "./stores/workflow-store";
import { creditChecksEnabled } from "./utils/credits";

const EXPIRED_OCCURRENCE_REPAIR_LIMIT = 100;
const CLAIM_HEARTBEAT_MS = 60_000;

type ScheduledTriggerEntry = Awaited<
  ReturnType<typeof getActiveScheduledTriggers>
>[number];

function expressionMatchesOccurrence(
  expression: string,
  scheduledTime: number,
): boolean {
  const previous = CronParser.parse(expression, {
    currentDate: new Date(scheduledTime + 1),
    tz: "UTC",
  })
    .prev()
    .toDate();
  return previous.getTime() === scheduledTime;
}

async function fingerprintWorkflowData(data: unknown): Promise<string> {
  const encoded = new TextEncoder().encode(JSON.stringify(data));
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function keepClaimAlive(
  env: Bindings,
  workflowId: string,
  scheduledTime: number,
  leaseToken: string,
): () => Promise<void> {
  let renewal = Promise.resolve();
  const timer = setInterval(() => {
    renewal = renewal
      .then(async () => {
        const renewed = await renewScheduledTriggerOccurrenceLease(env, {
          workflowId,
          scheduledTime,
          leaseToken,
        });
        if (!renewed) {
          console.error(
            `Lost scheduled trigger claim lease workflow=${workflowId} occurrence=${scheduledTime}`,
          );
        }
      })
      .catch((error) => {
        console.error("Failed to renew scheduled trigger claim lease:", error);
      });
  }, CLAIM_HEARTBEAT_MS);

  return async () => {
    clearInterval(timer);
    await renewal;
  };
}

async function dispatchScheduledOccurrence(
  env: Bindings,
  workflowStore: WorkflowStore,
  entry: ScheduledTriggerEntry,
  scheduledTime: number,
  timestamp: number,
): Promise<void> {
  const { scheduledTrigger, workflow, organizationBilling } = entry;
  let claim:
    Awaited<ReturnType<typeof claimScheduledTriggerOccurrence>> | undefined;
  let dispatched = false;
  let stopHeartbeat: (() => Promise<void>) | undefined;

  try {
    const workflowWithData = await workflowStore.getWithData(
      workflow.id,
      workflow.organizationId,
    );
    if (!workflowWithData?.data) {
      console.error(`Failed to load workflow data for ${workflow.id}`);
      return;
    }
    const workflowData = workflowWithData.data;
    const workflowFingerprint = await fingerprintWorkflowData(workflowData);
    claim = await claimScheduledTriggerOccurrence(env, {
      workflowId: workflow.id,
      scheduledTime,
      workflowFingerprint,
    });
    if (claim.status !== "acquired") {
      const message =
        `Skipping scheduled workflow ${workflow.id} occurrence=${new Date(scheduledTime).toISOString()} ` +
        `claim=${claim.status} execution=${claim.executionId}`;
      if (claim.status === "uncertain") {
        console.error(
          `[Scheduled trigger requires manual review] ${message}; automatic redispatch is suppressed`,
        );
      } else {
        console.log(message);
      }
      return;
    }

    const runtime = workflowData.runtime === "worker" ? "worker" : "workflow";
    const markedDispatched = await markScheduledTriggerOccurrenceDispatched(
      env,
      {
        workflowId: workflow.id,
        scheduledTime,
        leaseToken: claim.leaseToken,
        workflowFingerprint,
        runtime,
      },
    );
    if (!markedDispatched) {
      console.error(
        `Scheduled trigger claim expired before dispatch workflow=${workflow.id} occurrence=${scheduledTime}`,
      );
      return;
    }

    stopHeartbeat = keepClaimAlive(
      env,
      workflow.id,
      scheduledTime,
      claim.leaseToken,
    );
    dispatched = true;
    const execution = await WorkflowExecutor.execute({
      userId: "scheduled_trigger",
      organizationId: workflow.organizationId,
      ...resolveOrganizationBillingOptions(organizationBilling),
      workflow: {
        id: workflow.id,
        name: workflow.name,
        trigger: workflowData.trigger,
        runtime: workflowData.runtime,
        nodes: workflowData.nodes,
        edges: workflowData.edges,
      },
      scheduledTrigger: {
        timestamp,
        scheduledTime,
        scheduleExpression: scheduledTrigger.scheduleExpression,
      },
      executionId: claim.executionId,
      env,
    });
    console.log(
      `[Execution] ${execution.executionId} workflow=${workflow.id} runtime=${runtime} trigger=scheduled`,
    );
    await completeScheduledTriggerOccurrence(env, {
      workflowId: workflow.id,
      scheduledTime,
      leaseToken: claim.leaseToken,
    });
  } catch (error) {
    if (claim?.status === "acquired" && !dispatched) {
      await releaseScheduledTriggerOccurrence(env, {
        workflowId: workflow.id,
        scheduledTime,
        leaseToken: claim.leaseToken,
      }).catch((releaseError) => {
        console.error(
          "Failed to release scheduled trigger claim:",
          releaseError,
        );
      });
    }
    console.error(`Error executing scheduled workflow ${workflow.id}:`, error);
  } finally {
    await stopHeartbeat?.();
  }
}

export async function handleScheduledEvent(
  _event: ScheduledEvent,
  env: Bindings,
  _ctx: ExecutionContext,
): Promise<void> {
  if (env.SAVIA_FLOWS_MAINTENANCE === "true") return;
  console.log("Scheduled event triggered at:", new Date().toISOString());

  try {
    const retention = await maintainLocalExecutionHistory(env);
    if (retention.skipped === false && retention.deleted > 0) {
      console.log(
        `[Execution retention] deleted=${retention.deleted} cutoff=${new Date(retention.cutoff).toISOString()}`,
      );
    }
  } catch (error) {
    // History maintenance must not prevent scheduled workflow triggers. A
    // failed pass keeps its lease so the bounded cleanup can retry later.
    console.error("Execution history retention failed:", error);
  }

  try {
    await maintainFinishedCostReceipts(env);
  } catch (error) {
    console.error("Cost receipt retention failed", error);
  }
  try {
    const pruned = await pruneCompletedScheduledTriggerOccurrences(env, {
      limit: 100,
    });
    if (pruned > 0) {
      console.log(`[Scheduled trigger retention] deleted=${pruned}`);
    }
  } catch (error) {
    console.error("Scheduled trigger retention failed", error);
  }
  if (!(await policyStatus(env)).executionsEnabled) return;
  try {
    await flushSaviaCollectionEventBatch(env);
  } catch (error) {
    console.error("Collection batch maintenance failed", error);
  }

  const db = createDatabase(env.DB);
  const workflowStore = new WorkflowStore(env);

  const triggers = await getActiveScheduledTriggers(
    db,
    creditChecksEnabled(env.CLOUDFLARE_ENV),
  );
  console.log(`Found ${triggers.length} active scheduled triggers`);

  const now = Date.now();
  const expiredOccurrences = await listExpiredScheduledTriggerOccurrences(env, {
    now,
    limit: EXPIRED_OCCURRENCE_REPAIR_LIMIT,
  });
  const expiredByWorkflow = new Map<string, number[]>();
  for (const occurrence of expiredOccurrences) {
    const times = expiredByWorkflow.get(occurrence.workflowId) ?? [];
    times.push(occurrence.scheduledTime);
    expiredByWorkflow.set(occurrence.workflowId, times);
  }

  for (const { scheduledTrigger, workflow, organizationBilling } of triggers) {
    if (!workflow.enabled) {
      console.log(`Skipping scheduled workflow ${workflow.id}: not enabled`);
      continue;
    }

    try {
      const scheduledTime = CronParser.parse(
        scheduledTrigger.scheduleExpression,
        {
          currentDate: new Date(now),
          tz: "UTC",
        },
      )
        .prev()
        .toDate()
        .getTime();
      const occurrenceTimes = new Set(
        expiredByWorkflow
          .get(workflow.id)
          ?.filter((time) =>
            expressionMatchesOccurrence(
              scheduledTrigger.scheduleExpression,
              time,
            ),
          ) ?? [],
      );
      if (Math.abs(now - scheduledTime) <= 60_000) {
        occurrenceTimes.add(scheduledTime);
      }

      for (const occurrenceTime of [...occurrenceTimes].sort((a, b) => a - b)) {
        await dispatchScheduledOccurrence(
          env,
          workflowStore,
          { scheduledTrigger, workflow, organizationBilling },
          occurrenceTime,
          now,
        );
      }
    } catch (error) {
      console.error(
        `Failed to parse schedule for workflow ${workflow.id}:`,
        error,
      );
    }
  }
}
