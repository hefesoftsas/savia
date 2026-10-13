import type { QueueMessage, Workflow } from "@savia/flows-types";
import type { Bindings } from "./context";
import { createDatabase } from "./db";
import {
  getOrganizationBillingInfo,
  getQueueTriggersByQueue,
  resolveOrganizationBillingOptions,
} from "./db/queries";
import { getWorkflowAgentByName } from "./durable-objects/agent-utils";
import { CloudflareExecutionStore } from "./runtime/cloudflare-execution-store";
import { createWorkerRuntime } from "./runtime/cloudflare-worker-runtime";
import { queueExecutionId, queueRetryDelaySeconds } from "./queue-backoff";
import { WorkflowStore } from "./stores/workflow-store";
import { isCreditExhausted } from "./utils/credits";

const TERMINAL_EXECUTION_STATUSES = new Set([
  "completed",
  "error",
  "cancelled",
  "exhausted",
]);

function retryMessage(message: Message, reason: string): void {
  const delaySeconds = queueRetryDelaySeconds(message.attempts);
  console.warn(
    `Retrying Flows queue message ${message.id} in ${delaySeconds}s: ${reason}`,
  );
  message.retry({ delaySeconds });
}

// This function handles the actual execution triggering
async function executeWorkflow(
  workflowInfo: {
    id: string;
    name: string;
    organizationId: string;
  },
  workflowData: Workflow,
  queueMessage: QueueMessage,
  executionId: string,
  db: ReturnType<typeof createDatabase>,
  env: Bindings,
  _ctx: ExecutionContext,
): Promise<void> {
  console.log(
    `Attempting to execute workflow ${workflowInfo.id} via queue message.`,
  );

  try {
    // Get organization billing info
    const billingInfo = await getOrganizationBillingInfo(
      db,
      workflowInfo.organizationId,
    );
    if (billingInfo === undefined) {
      console.error("Organization not found");
      return;
    }

    if (isCreditExhausted(billingInfo, env.CLOUDFLARE_ENV)) {
      console.log(
        `Skipping queue trigger for workflow ${workflowInfo.id}: credits exhausted`,
      );
      return;
    }

    const billingOptions = resolveOrganizationBillingOptions(billingInfo);

    const executionParams = {
      userId: "queue_trigger",
      organizationId: workflowInfo.organizationId,
      ...billingOptions,
      workflow: {
        id: workflowInfo.id,
        name: workflowData.name,
        trigger: workflowData.trigger,
        runtime: workflowData.runtime,
        nodes: workflowData.nodes,
        edges: workflowData.edges,
      },
      queueMessage: {
        queueId: queueMessage.queueId,
        organizationId: queueMessage.organizationId,
        payload: queueMessage.payload,
        timestamp: queueMessage.timestamp,
      },
    };

    // Use WorkerRuntime for "worker" runtime (synchronous execution)
    // Use Cloudflare Workflows for "workflow" runtime (durable execution, default)
    if (workflowData.runtime === "worker") {
      const existing = await new CloudflareExecutionStore(env).getWithData(
        executionId,
        workflowInfo.organizationId,
      );
      if (
        existing?.data.workflowId === workflowInfo.id &&
        TERMINAL_EXECUTION_STATUSES.has(existing.data.status)
      ) {
        if (existing.data.status !== "completed") {
          throw new Error(
            `Queue workflow execution previously ended with ${existing.data.status}`,
          );
        }
        console.log(
          `[Execution] ${existing.data.id} workflow=${workflowInfo.id} runtime=worker trigger=queue duplicate=deduplicated`,
        );
        return;
      }
      const workerRuntime = createWorkerRuntime(env);
      const execution = await workerRuntime.execute(
        executionParams,
        executionId,
      );
      if (execution.status !== "completed") {
        throw new Error(
          execution.error ??
            `Workflow execution ended with ${execution.status}`,
        );
      }
      console.log(
        `[Execution] ${execution.id} workflow=${workflowInfo.id} runtime=worker trigger=queue`,
      );
    } else {
      const agent = await getWorkflowAgentByName(env, workflowInfo.id);
      const startedExecutionId = await agent.executeWorkflow(
        executionParams,
        executionId,
      );
      console.log(
        `[Execution] ${startedExecutionId} workflow=${workflowInfo.id} runtime=workflow trigger=queue`,
      );
    }
  } catch (execError) {
    console.error(`Error executing workflow ${workflowInfo.id}:`, execError);
    throw execError;
  }
}

export async function handleQueueMessages(
  batch: MessageBatch,
  env: Bindings,
  ctx: ExecutionContext,
): Promise<void> {
  if (
    env.SAVIA_FLOWS_EXECUTION_ENABLED === "false" ||
    env.SAVIA_FLOWS_MAINTENANCE === "true"
  ) {
    for (const message of batch.messages) {
      retryMessage(
        message,
        env.SAVIA_FLOWS_MAINTENANCE === "true"
          ? "Flows is in maintenance mode"
          : "Flows execution is paused",
      );
    }
    return;
  }

  console.log(`Queue batch received with ${batch.messages.length} messages`);
  const db = createDatabase(env.DB);
  const workflowStore = new WorkflowStore(env);

  try {
    for (const message of batch.messages) {
      try {
        // Parse the message body
        const queueMessage = message.body as QueueMessage;

        console.log(
          `Processing message for queue: ${queueMessage.queueId}, org: ${queueMessage.organizationId}`,
        );

        // Get all active queue triggers for this queue
        const triggers = await getQueueTriggersByQueue(
          db,
          queueMessage.queueId,
          queueMessage.organizationId,
        );

        if (triggers.length === 0) {
          console.log(
            `No active triggers found for queue ${queueMessage.queueId}`,
          );
          message.ack();
          continue;
        }

        console.log(`Found ${triggers.length} active triggers for this queue.`);
        let processingFailed = false;

        // Deduplicate workflows to avoid loading same workflow multiple times
        const workflowCache = new Map<
          string,
          {
            data: Workflow;
            workflow: (typeof triggers)[0]["workflow"];
          }
        >();

        // Load each unique workflow once
        for (const item of triggers) {
          const { workflow } = item;

          if (workflowCache.has(workflow.id)) {
            continue; // Already loaded this workflow
          }

          // Skip workflows that are not enabled
          if (!workflow.enabled) {
            console.log(`Skipping workflow ${workflow.id}: not enabled`);
            continue;
          }

          console.log(`Loading workflow: ${workflow.id}`);

          try {
            const workflowWithData = await workflowStore.getWithData(
              workflow.id,
              workflow.organizationId,
            );
            if (!workflowWithData) {
              processingFailed = true;
              console.error(
                `Failed to load workflow data for ${workflow.id}: not found`,
              );
              continue;
            }

            workflowCache.set(workflow.id, {
              data: workflowWithData.data,
              workflow,
            });
          } catch (err) {
            console.error(`Error loading workflow ${workflow.id}:`, err);
            processingFailed = true;
          }
        }

        // Execute each trigger with its corresponding workflow
        for (const item of triggers) {
          const { workflow } = item;
          const cached = workflowCache.get(workflow.id);

          if (!cached) {
            console.log(
              `Skipping trigger for workflow ${workflow.id}: failed to load`,
            );
            continue;
          }

          console.log(`Executing trigger for workflow: ${workflow.id}`);

          try {
            const workflowInfo = {
              id: workflow.id,
              name: workflow.name,
              organizationId: workflow.organizationId,
            };
            const executionId = await queueExecutionId(message.id, workflow.id);

            await executeWorkflow(
              workflowInfo,
              cached.data,
              queueMessage,
              executionId,
              db,
              env,
              ctx,
            );
          } catch (err) {
            console.error(`Error executing workflow ${workflow.id}:`, err);
            processingFailed = true;
          }
        }

        if (processingFailed) {
          retryMessage(message, "one or more queue-trigger workflows failed");
          continue;
        }

        // Acknowledge the message after processing all triggers
        message.ack();
        console.log(`Message acknowledged for queue ${queueMessage.queueId}`);
      } catch (messageError) {
        console.error("Error processing queue message:", messageError);
        retryMessage(message, "queue message processing failed");
      }
    }
  } catch (batchError) {
    console.error("Error processing queue batch:", batchError);
  }
}
