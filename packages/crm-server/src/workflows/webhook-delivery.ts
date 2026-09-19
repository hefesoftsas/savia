import type {
  WorkflowContext,
  WorkflowNode,
} from "@savia/crm-shared/workflows";
import { resolveWorkflowValue } from "@savia/crm-shared/workflows";
import type { ExecutionRow } from "./repository";
import {
  WebhookDestinationRepository,
  type WebhookDependencies,
} from "./webhook-destinations";
import { sendWorkflowWebhook } from "./webhook-transport";
import { webhookHash } from "./webhook-endpoints";
import { guard, transaction } from "../services";
import { fail } from "../context";
type Delivery = {
  payload: string;
  stable_key: string;
  attempt_count: number;
  generation_attempts: number;
};
export async function executeWebhookNode(
  db: D1Database,
  run: ExecutionRow,
  node: Extract<WorkflowNode, { type: "webhook" }>,
  context: WorkflowContext,
  token: string,
  now: number,
  dependencies: WebhookDependencies,
) {
  const scoped = [run.workspace_id, run.id, node.id];
  const fencing = () =>
    guard(
      db,
      "SELECT 1 FROM workflow_executions WHERE workspace_id=? AND id=? AND lease_token=? AND status='running' AND lease_until>?",
      [run.workspace_id, run.id, token, Date.now()],
    );
  let delivery = await db
    .prepare(
      "SELECT * FROM workflow_webhook_deliveries WHERE workspace_id=? AND execution_id=? AND node_id=?",
    )
    .bind(...scoped)
    .first<Delivery>();
  if (!delivery) {
    const payload = JSON.stringify(
      Object.fromEntries(
        Object.entries(node.values).map(([k, v]) => [
          k,
          resolveWorkflowValue(v, context),
        ]),
      ),
    );
    if (new TextEncoder().encode(payload).length > 32768)
      fail("Webhook payload exceeds 32 KiB", 413);
    const key = await webhookHash(JSON.stringify(scoped)),
      g = fencing();
    await transaction(db, [
      g.start,
      db
        .prepare(
          "INSERT INTO workflow_webhook_deliveries(workspace_id,execution_id,node_id,destination_id,destination_revision,payload,stable_key) VALUES (?,?,?,?,?,?,?)",
        )
        .bind(
          ...scoped,
          node.destinationId,
          node.destinationRevision,
          payload,
          key,
        ),
      g.end,
    ]);
    delivery = {
      payload,
      stable_key: key,
      attempt_count: 0,
      generation_attempts: 0,
    };
  }
  if (delivery.generation_attempts >= 3) {
    const expired = fencing();
    await transaction(db, [
      expired.start,
      db
        .prepare(
          "UPDATE workflow_webhook_attempts SET finished_at=?,error='Delivery outcome unknown after lease expiry' WHERE workspace_id=? AND execution_id=? AND node_id=? AND finished_at IS NULL",
        )
        .bind(Date.now(), ...scoped),
      db
        .prepare(
          "UPDATE workflow_webhook_deliveries SET state='failed' WHERE workspace_id=? AND execution_id=? AND node_id=?",
        )
        .bind(...scoped),
      expired.end,
    ]);
    fail(
      "Webhook automatic attempts exhausted; prior delivery may have been accepted",
      422,
    );
  }
  const destination = await new WebhookDestinationRepository(
    db,
    run.workspace_id,
    dependencies,
  ).resolve(node.destinationId, node.destinationRevision);
  const sequence = delivery.attempt_count + 1,
    g = fencing();
  await transaction(db, [
    g.start,
    db
      .prepare(
        "UPDATE workflow_webhook_attempts SET finished_at=?,error='Delivery outcome unknown after lease expiry' WHERE workspace_id=? AND execution_id=? AND node_id=? AND finished_at IS NULL",
      )
      .bind(Date.now(), ...scoped),
    db
      .prepare(
        "UPDATE workflow_webhook_deliveries SET attempt_count=attempt_count+1,generation_attempts=generation_attempts+1,state='sending' WHERE workspace_id=? AND execution_id=? AND node_id=?",
      )
      .bind(...scoped),
    db
      .prepare(
        "INSERT INTO workflow_webhook_attempts(workspace_id,execution_id,node_id,sequence,lease_token,started_at) VALUES (?,?,?,?,?,?)",
      )
      .bind(...scoped, sequence, token, Date.now()),
    g.end,
  ]);
  const result = await sendWorkflowWebhook(
    {
      ...destination,
      payload: delivery.payload,
      key: delivery.stable_key,
      executionId: run.id,
      nodeId: node.id,
    },
    dependencies,
  );
  const success =
    result.status !== null && result.status >= 200 && result.status < 300;
  const retry = result.retryable && delivery.generation_attempts + 1 < 3;
  const updated = {
    ...context,
    steps: { ...context.steps, [node.id]: result.output },
  };
  const contextTooLarge = JSON.stringify(updated).length > 256000;
  const finished = success && !contextTooLarge,
    checkpoint = fencing();
  const statements = [
    checkpoint.start,
    db
      .prepare(
        "UPDATE workflow_webhook_attempts SET finished_at=?,status=?,error=?,output=? WHERE workspace_id=? AND execution_id=? AND node_id=? AND sequence=? AND lease_token=?",
      )
      .bind(
        Date.now(),
        result.status,
        result.error,
        JSON.stringify(result.output),
        ...scoped,
        sequence,
        token,
      ),
    db
      .prepare(
        "UPDATE workflow_webhook_deliveries SET state=? WHERE workspace_id=? AND execution_id=? AND node_id=?",
      )
      .bind(finished ? "completed" : retry ? "waiting" : "failed", ...scoped),
  ];
  if (finished)
    statements.push(
      db
        .prepare(
          "INSERT INTO workflow_jobs(workspace_id,execution_id,node_id,sequence,type,input,output,attempts) VALUES (?,?,?,?,?,?,?,?)",
        )
        .bind(
          ...scoped,
          Object.keys(context.steps).length,
          "webhook",
          JSON.stringify(node),
          JSON.stringify(result.output),
          sequence,
        ),
    );
  statements.push(
    db
      .prepare(
        "UPDATE workflow_executions SET status=?,node_id=?,context=?,wake_at=?,attempts=0,error=?,lease_token=NULL,updated_at=CURRENT_TIMESTAMP WHERE workspace_id=? AND id=?",
      )
      .bind(
        finished
          ? node.next
            ? "queued"
            : "completed"
          : retry
            ? "waiting"
            : "failed",
        finished ? (node.next ?? null) : node.id,
        finished ? JSON.stringify(updated) : run.context,
        retry
          ? now +
              (result.retryAfterMs ??
                (delivery.generation_attempts === 0 ? 5000 : 30000))
          : 0,
        contextTooLarge ? "Execution context exceeds 256 KB" : result.error,
        run.workspace_id,
        run.id,
      ),
    checkpoint.end,
  );
  await transaction(db, statements);
}
