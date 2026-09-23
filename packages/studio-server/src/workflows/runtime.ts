import { dialectFor } from "@savia/db/dialect";
import { executeWebhookNode } from "./webhook-delivery";
import type { WebhookDependencies } from "./webhook-destinations";
import { workflowResumeAt } from "@savia/studio-shared/workflows";
import { workflowTaskNotice } from "../notifications/collection-events";
import { historyDatabase } from "../record-history-storage";
import {
  evaluateWorkflowCondition,
  resolveWorkflowValue,
  workflowDefinitionSchema,
  type WorkflowContext,
  type WorkflowNode,
} from "@savia/studio-shared/workflows";
import {
  createRecord,
  getObject,
  updateRecord,
  getRecord,
  guard,
  parseRecord,
  transaction,
} from "../services";
import { WorkflowRepository, type ExecutionRow } from "./repository";

export type WorkflowAuthorization = (identity: {
  workspace: string;
  principalId: string;
}) => Promise<boolean>;
const json = (value: unknown) => JSON.stringify(value);

async function schedule(db: D1Database, now: number) {
  const due = await db
    .prepare(
      "SELECT w.*,v.definition AS published_definition,v.owner_id FROM workflows w JOIN workflow_versions v ON v.workspace_id=w.workspace_id AND v.id=w.published_version WHERE w.enabled=1 AND w.next_run_at<=? LIMIT 50",
    )
    .bind(now)
    .all<{
      workspace_id: string;
      id: string;
      published_version: string;
      published_definition: string;
      owner_id: string;
      next_run_at: number;
    }>();
  for (const row of due.results) {
    const definition = workflowDefinitionSchema.parse(
      JSON.parse(row.published_definition),
    );
    if (definition.trigger.type !== "schedule") continue;
    const g = guard(
      db,
      "SELECT enabled=1 AND next_run_at=? AND published_version=? FROM workflows WHERE workspace_id=? AND id=?",
      [row.next_run_at, row.published_version, row.workspace_id, row.id],
    );
    try {
      await transaction(db, [
        g.start,
        db
          .prepare(
            "INSERT INTO workflow_executions(workspace_id,id,workflow_id,version_id,owner_id,initiator_id,event_key,node_id,context) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(workspace_id,workflow_id,event_key) DO NOTHING",
          )
          .bind(
            row.workspace_id,
            crypto.randomUUID(),
            row.id,
            row.published_version,
            row.owner_id,
            row.owner_id,
            `schedule:${row.published_version}:${row.next_run_at}`,
            definition.nodes[0].id,
            json({
              trigger: { scheduledAt: new Date(row.next_run_at).toISOString() },
              before: {},
              steps: {},
              system: { owner: row.owner_id, workspace: row.workspace_id },
            }),
          ),
        db
          .prepare(
            "UPDATE workflows SET next_run_at=? WHERE workspace_id=? AND id=?",
          )
          .bind(
            Math.max(
              row.next_run_at + definition.trigger.intervalMinutes * 60000,
              now + definition.trigger.intervalMinutes * 60000,
            ),
            row.workspace_id,
            row.id,
          ),
        g.end,
      ]);
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !("status" in error) ||
        error.status !== 409
      )
        throw error;
    }
  }
}

/** A bounded tick. Leases fence every checkpoint, including native side effects. */
export async function processWorkflows(
  db: D1Database,
  authorize: WorkflowAuthorization,
  options: {
    now?: number;
    maxSteps?: number;
    webhooks?: WebhookDependencies;
  } = {},
) {
  const now = options.now ?? Date.now();
  await schedule(db, now);
  for (let step = 0; step < Math.min(options.maxSteps ?? 100, 200); step++) {
    const token = crypto.randomUUID();
    const run = await db
      .prepare(
        "UPDATE workflow_executions SET status='running',lease_token=?,lease_until=?,attempts=attempts+1 WHERE (workspace_id,id)=(SELECT workspace_id,id FROM workflow_executions WHERE (status IN ('queued','waiting') AND wake_at<=?) OR (status='running' AND lease_until<=?) ORDER BY created_at,id LIMIT 1) RETURNING *",
      )
      .bind(token, Date.now() + 30000, now, now)
      .first<ExecutionRow>();
    if (!run) break;
    try {
      if (
        !(await authorize({
          workspace: run.workspace_id,
          principalId: run.owner_id,
        }))
      ) {
        await db
          .prepare(
            "UPDATE workflow_executions SET status='blocked',error='Execution permission revoked',lease_token=NULL WHERE workspace_id=? AND id=? AND lease_token=?",
          )
          .bind(run.workspace_id, run.id, token)
          .run();
        continue;
      }
      const version = await db
        .prepare(
          "SELECT definition FROM workflow_versions WHERE workspace_id=? AND id=?",
        )
        .bind(run.workspace_id, run.version_id)
        .first<{ definition: string }>();
      if (!version) throw new Error("Published version missing");
      const definition = workflowDefinitionSchema.parse(
        JSON.parse(version.definition),
      );
      await new WorkflowRepository(db, run.workspace_id).validate(definition);
      const context = JSON.parse(run.context) as WorkflowContext;
      const node = definition.nodes.find((n) => n.id === run.node_id);
      if (!node) {
        await db
          .prepare(
            "UPDATE workflow_executions SET status='completed',lease_token=NULL WHERE workspace_id=? AND id=? AND lease_token=?",
          )
          .bind(run.workspace_id, run.id, token)
          .run();
        continue;
      }
      if (node.type === "webhook")
        await executeWebhookNode(
          db,
          run,
          node,
          context,
          token,
          now,
          options.webhooks ?? {},
        );
      else await executeNode(db, run, node, context, token, now);
    } catch (error) {
      const status =
        error && typeof error === "object" && "status" in error
          ? Number(error.status)
          : 0;
      const retry = !status && run.attempts < 3;
      await db
        .prepare(
          "UPDATE workflow_executions SET status=?,error=?,wake_at=?,lease_token=NULL,updated_at=CURRENT_TIMESTAMP WHERE workspace_id=? AND id=? AND lease_token=? AND status='running'",
        )
        .bind(
          retry ? "queued" : "failed",
          String(error).slice(0, 1000),
          now + run.attempts * 5000,
          run.workspace_id,
          run.id,
          token,
        )
        .run();
    }
  }
}

async function executeNode(
  db: D1Database,
  run: ExecutionRow,
  node: WorkflowNode,
  context: WorkflowContext,
  token: string,
  now: number,
) {
  db = historyDatabase(db, run.workspace_id, {
    kind: "workflow",
    id: run.owner_id,
    causeId: run.id,
  });
  const value = (v: Parameters<typeof resolveWorkflowValue>[0]) =>
    resolveWorkflowValue(v, context);
  const mapped = (values: Record<string, Parameters<typeof value>[0]>) =>
    Object.fromEntries(
      Object.entries(values).map(([key, v]) => [key, value(v)]),
    );
  const g = guard(
    db,
    "SELECT EXISTS(SELECT 1 FROM workflow_executions WHERE workspace_id=? AND id=? AND status='running' AND lease_token=? AND lease_until>?)",
    [run.workspace_id, run.id, token, Date.now()],
  );
  let next = node.next ?? null;
  const finish = (output: unknown) => {
    const updated = {
      ...context,
      steps: { ...context.steps, [node.id]: output },
    };
    if (json(updated).length > 256000)
      throw new Error("Execution context exceeds 256 KB");
    return [
      db
        .prepare(
          "INSERT INTO workflow_jobs(workspace_id,execution_id,node_id,sequence,type,input,output,attempts) VALUES (?,?,?,?,?,?,?,?)",
        )
        .bind(
          run.workspace_id,
          run.id,
          node.id,
          Object.keys(context.steps).length,
          node.type,
          json(node),
          json(output),
          run.attempts,
        ),
      db
        .prepare(
          "UPDATE workflow_executions SET node_id=?,context=?,status=?,wake_at=?,attempts=0,error=NULL,lease_token=NULL,updated_at=CURRENT_TIMESTAMP WHERE workspace_id=? AND id=?",
        )
        .bind(
          next,
          json(updated),
          node.type === "delay" ? "waiting" : next ? "queued" : "completed",
          node.type === "delay" ? workflowResumeAt(node, context, now) : 0,
          run.workspace_id,
          run.id,
        ),
      g.end,
    ];
  };
  const nativeCheckpoint = (id: string) => ({
    before: [
      g.start,
      db
        .prepare(
          "INSERT INTO workflow_write_context(workspace_id,record_id,depth,cause) VALUES (?,?,?,?)",
        )
        .bind(run.workspace_id, id, run.depth + 1, run.id),
    ],
    after: (output: unknown) => [
      ...finish(output),
      db
        .prepare(
          "DELETE FROM workflow_write_context WHERE workspace_id=? AND record_id=?",
        )
        .bind(run.workspace_id, id),
    ],
  });
  if (node.type === "create") {
    const input = mapped(node.values);
    const findMatch = async () => {
      if (!node.matchField) return null;
      const object = await getObject(db, run.workspace_id, node.collection);
      if (
        !object.config.fields[node.matchField]?.config?.unique ||
        object.config.fields[node.matchField]?.config?.multiple ||
        !["Textbox", "Dropdown"].includes(
          object.config.fields[node.matchField]?.type,
        )
      )
        throw new Error("Matched creation requires a unique field");
      const match = input[node.matchField];
      if (typeof match !== "string" || !match.trim())
        throw new Error("Matched creation requires a nonempty text key");
      const row = await db
        .prepare(
          "SELECT record_id FROM crm_unique_values WHERE tenant_id=? AND object_name=? AND field_name=? AND value=?",
        )
        .bind(
          run.workspace_id,
          node.collection,
          node.matchField,
          match.trim().toLocaleLowerCase(),
        )
        .first<{ record_id: string }>();
      return row
        ? getRecord(db, run.workspace_id, node.collection, row.record_id)
        : null;
    };
    const existing = await findMatch();
    if (existing) {
      await transaction(db, [g.start, ...finish(existing)]);
      return;
    }
    const id = crypto.randomUUID();
    try {
      await createRecord(db, run.workspace_id, node.collection, input, {
        id,
        createdBy: run.owner_id,
        checkpoint: nativeCheckpoint(id),
      });
    } catch (error) {
      // Unique index arbitrates concurrent source events. A replay returns the
      // existing record and checkpoints this execution without overwriting it.
      const winner = await findMatch();
      if (!winner) throw error;
      await transaction(db, [g.start, ...finish(winner)]);
    }
    return;
  }
  if (node.type === "update") {
    const id = value(node.recordId);
    if (typeof id !== "string" || !id)
      throw new Error("Update requires a record identifier");
    const record = await getRecord(db, run.workspace_id, node.collection, id);
    await updateRecord(
      db,
      run.workspace_id,
      node.collection,
      id,
      mapped(node.values),
      { version: record._version!, checkpoint: nativeCheckpoint(id) },
    );
    return;
  }
  let output: unknown;
  const effects: D1PreparedStatement[] = [];
  switch (node.type) {
    case "condition": {
      const matches = evaluateWorkflowCondition(node, context);
      next = (matches ? node.next : node.otherwise) ?? null;
      output = { matches };
      break;
    }
    case "transform":
      output = mapped(node.values);
      break;
    case "query": {
      const expected = value(node.value);
      if (
        expected !== null &&
        !["string", "number", "boolean"].includes(typeof expected)
      )
        throw new Error("Query value must be scalar");
      const comparison =
        node.field === "id"
          ? {
              sql: `id ${dialectFor(db).nullSafeEqual} ?`,
              parameters: [
                typeof expected === "boolean" ? Number(expected) : expected,
              ],
            }
          : dialectFor(db).jsonCompare(
              "data",
              `$.${node.field}`,
              "eq",
              expected,
            );
      const rows = await db
        .prepare(
          `SELECT * FROM crm_records WHERE tenant_id=? AND object_name=? AND deleted_at IS NULL AND ${comparison.sql} LIMIT ?`,
        )
        .bind(
          run.workspace_id,
          node.collection,
          ...comparison.parameters,
          node.limit,
        )
        .all();
      output = {
        records: rows.results.map(parseRecord),
        count: rows.results.length,
      };
      break;
    }
    case "task":
    case "notification": {
      const title = value(node.title),
        assignee = value(node.assignee);
      if (
        typeof title !== "string" ||
        !title.trim() ||
        title.length > 500 ||
        typeof assignee !== "string" ||
        !assignee ||
        assignee.length > 200
      )
        throw new Error("Task requires a title and assignee");
      const id = crypto.randomUUID();
      effects.push(
        db
          .prepare(
            "INSERT INTO workflow_tasks(workspace_id,id,execution_id,node_id,kind,title,assignee,due_at) VALUES (?,?,?,?,?,?,?,?)",
          )
          .bind(
            run.workspace_id,
            id,
            run.id,
            node.id,
            node.type,
            title,
            assignee,
            node.type === "task" ? now + node.dueDays * 86400000 : null,
          ),
      );
      if (node.type === "task") {
        effects.push(
          ...workflowTaskNotice(
            db,
            run.workspace_id,
            run.id,
            node.id,
            id,
            title.slice(0, 500),
            "",
            assignee,
            now,
          ),
        );
      }
      output = { id };
      break;
    }
    case "delay":
      output = {
        resumeAt: new Date(workflowResumeAt(node, context, now)).toISOString(),
      };
      break;
  }
  await transaction(db, [g.start, ...effects, ...finish(output)]);
}
