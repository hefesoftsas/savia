import { dialectFor } from "@savia/db/dialect";
import { executeWebhookNode } from "./webhook-delivery";
import {
  WebhookDestinationRepository,
  type WebhookDependencies,
} from "./webhook-destinations";
import { sendWorkflowHttpRequest } from "./http-request";
import {
  executeWorkflowPiece,
  findWorkflowPiece,
  resolveWorkflowPieces,
  type WorkflowPieceHandler,
} from "./pieces";
import { fail } from "../context";
import { workflowResumeAt } from "@savia/studio-shared/workflows";
import { workflowTaskNotice } from "../notifications/collection-events";
import { historyDatabase } from "../record-history-storage";
import { cronNextOccurrence } from "@savia/studio-shared/workflow-cron";
import {
  evaluateWorkflowCondition,
  loopBodyMembers,
  matchWorkflowSwitchCase,
  parallelRegions,
  resolveWorkflowValue,
  workflowDefinitionSchema,
  type LoopHead,
  type WorkflowContext,
  type WorkflowDefinition,
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
    let following: number | null;
    try {
      following =
        definition.trigger.cron !== undefined
          ? cronNextOccurrence(
              definition.trigger.cron,
              Math.max(row.next_run_at, now),
            )
          : Math.max(
              row.next_run_at + definition.trigger.intervalMinutes! * 60000,
              now + definition.trigger.intervalMinutes! * 60000,
            );
    } catch {
      continue;
    }
    if (following === null) continue;
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
          .bind(following, row.workspace_id, row.id),
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
export type WorkflowHistoryReport = {
  executions: number;
  inbox: number;
  events: number;
};
export async function maintainWorkflowHistory(
  db: D1Database,
): Promise<WorkflowHistoryReport> {
  const overflow = `(SELECT workspace_id, id FROM (SELECT workspace_id, id, ROW_NUMBER() OVER (PARTITION BY workspace_id, workflow_id ORDER BY created_at DESC, id DESC) AS rn, status FROM workflow_executions) WHERE rn > 100 AND status IN ('completed','failed','blocked','cancelled') LIMIT 500)`;
  for (const table of [
    "workflow_jobs",
    "workflow_webhook_attempts",
    "workflow_webhook_deliveries",
    "workflow_webhook_receipts",
    "workflow_tasks",
    "workflow_approvals",
  ]) {
    await db
      .prepare(
        `DELETE FROM ${table} WHERE (workspace_id, execution_id) IN ${overflow}`,
      )
      .run();
  }
  const pruned = await db
    .prepare(`DELETE FROM workflow_executions WHERE (workspace_id, id) IN ${overflow}`)
    .run();
  let inbox = 0;
  for (const sql of [
    "DELETE FROM workflow_tasks WHERE status='done' AND created_at < datetime('now','-90 days')",
    "DELETE FROM workflow_approvals WHERE status IN ('decided','expired') AND created_at < datetime('now','-90 days')",
  ]) {
    const result = await db.prepare(sql).run();
    inbox += result.meta.changes ?? 0;
  }
  const events = await db
    .prepare("DELETE FROM workflow_events WHERE created_at < datetime('now','-90 days')")
    .run();
  return {
    executions: pruned.meta.changes ?? 0,
    inbox,
    events: events.meta.changes ?? 0,
  };
}
export async function processWorkflows(
  db: D1Database,
  authorize: WorkflowAuthorization,
  options: {
    now?: number;
    maxSteps?: number;
    webhooks?: WebhookDependencies;
    pieces?: WorkflowPieceHandler[];
    onExecutionTransition?: (workspace: string, executionId: string) => void;
  } = {},
) {
  const notifyTransition = (workspace: string, executionId: string) => {
    try {
      options.onExecutionTransition?.(workspace, executionId);
    } catch {
      // Realtime is advisory and must not affect workflow execution.
    }
  };
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
    notifyTransition(run.workspace_id, run.id);
    let failedNode: WorkflowNode | null = null;
    let failedContext: WorkflowContext | null = null;
    let failedMeta: GraphMeta | null = null;
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
        notifyTransition(run.workspace_id, run.id);
        continue;
      }
      const rawContext = JSON.parse(run.context) as WorkflowContext;
      const previewCalls = rawContext.calls ?? [];
      const currentId = rawContext.branches?.[0] ?? run.node_id;
      const ownerVersion = previewCalls.length
        ? previewCalls[previewCalls.length - 1].version
        : run.version_id;
      const version = await db
        .prepare(
          "SELECT definition FROM workflow_versions WHERE workspace_id=? AND id=?",
        )
        .bind(run.workspace_id, ownerVersion)
        .first<{ definition: string }>();
      if (!version) throw new Error("Published version missing");
      const definition = workflowDefinitionSchema.parse(
        JSON.parse(version.definition),
      );
      await new WorkflowRepository(db, run.workspace_id).validate(definition);
      const { enrichExecutionContext } = await import("./relations");
      const context = await enrichExecutionContext(
        db,
        run.workspace_id,
        definition,
        rawContext,
      );
      const pending = context.calls ?? [];
      const node = definition.nodes.find((n) => n.id === currentId);
      if (!node) {
        if (!pending.length) {
          await db
            .prepare(
              "UPDATE workflow_executions SET status='completed',lease_token=NULL WHERE workspace_id=? AND id=? AND lease_token=?",
            )
            .bind(run.workspace_id, run.id, token)
            .run();
          notifyTransition(run.workspace_id, run.id);
          continue;
        }
        const frame = pending[pending.length - 1];
        const output = { steps: context.steps };
        const restored: WorkflowContext = {
          ...frame.saved,
          steps: { ...frame.saved.steps, [frame.returnNode]: output },
          returned: {
            ...(frame.saved.returned ?? {}),
            [frame.returnNode]: output,
          },
          calls: pending.slice(0, -1),
        };
        if (JSON.stringify(restored).length > 256000) {
          await db
            .prepare(
              "UPDATE workflow_executions SET status='failed',error=?,wake_at=?,lease_token=NULL,updated_at=CURRENT_TIMESTAMP WHERE workspace_id=? AND id=? AND lease_token=?",
            )
            .bind(
              "Subflow result exceeds 256 KB",
              now,
              run.workspace_id,
              run.id,
              token,
            )
            .run();
          notifyTransition(run.workspace_id, run.id);
          continue;
        }
        await db
          .prepare(
            "UPDATE workflow_executions SET node_id=?,context=?,status='queued',wake_at=0,attempts=0,error=NULL,lease_token=NULL,updated_at=CURRENT_TIMESTAMP WHERE workspace_id=? AND id=? AND lease_token=?",
          )
          .bind(
            frame.returnNode,
            JSON.stringify(restored),
            run.workspace_id,
            run.id,
            token,
          )
          .run();
        notifyTransition(run.workspace_id, run.id);
        continue;
      }
      failedNode = node;
      failedContext = context;
      failedMeta = graphMetaFor(definition);
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
      else
        await executeNode(
          db,
          run,
          node,
          context,
          token,
          now,
          failedMeta,
          options.webhooks ?? {},
          resolveWorkflowPieces(options.pieces),
        );
      notifyTransition(run.workspace_id, run.id);
    } catch (error) {
      const status =
        error && typeof error === "object" && "status" in error
          ? Number(error.status)
          : 0;
      const maxAttempts = failedNode?.maxAttempts ?? 3;
      const retry = !status && run.attempts < maxAttempts;
      if (
        !retry &&
        failedNode &&
        failedContext &&
        failedNode.onError === "continue"
      ) {
        try {
          await continueAfterError(
            db,
            run,
            failedNode,
            failedContext,
            token,
            now,
            String(error).slice(0, 1000),
            failedMeta,
          );
        } catch {
          // Lease lost or execution cancelled; leave its state untouched.
        }
        notifyTransition(run.workspace_id, run.id);
        continue;
      }
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
      notifyTransition(run.workspace_id, run.id);
    }
  }
  try {
    await maintainWorkflowHistory(db);
  } catch {
    // Maintenance is best effort and must not fail execution progress.
  }
}

function defaultContinueTarget(node: WorkflowNode): string | null {
  if (node.type === "condition") return node.otherwise ?? node.next ?? null;
  if (node.type === "switch") return node.otherwise ?? null;
  return node.next ?? null;
}

type LoopMeta = {
  heads: Map<string, LoopHead>;
  sets: Map<string, Set<string>>;
  owner: Map<string, string>;
};
type ParallelMeta = ReturnType<typeof parallelRegions>;
type GraphMeta = { loops: LoopMeta; parallel: ParallelMeta };
function graphMetaFor(definition: WorkflowDefinition): GraphMeta {
  const heads = new Map<string, LoopHead>(),
    sets = new Map<string, Set<string>>(),
    owner = new Map<string, string>();
  for (const node of definition.nodes) {
    if (node.type !== "loop") continue;
    heads.set(node.id, node);
    const members = loopBodyMembers(definition, node.id).members;
    sets.set(node.id, members);
    for (const member of members)
      if (!owner.has(member)) owner.set(member, node.id);
  }
  return {
    loops: { heads, sets, owner },
    parallel: parallelRegions(definition),
  };
}

/**
 * Synchronous parallel routing for a completing step. Null branches/merges
 * mean omit the key. The merge barrier counts down in context instead of
 * reading jobs: each branch end decrements its merge counter, and the join
 * enters the active set at zero. The current node's own job commits in the
 * same transaction, so an end counts itself as done.
 */
function routeParallelFinish(
  regions: ParallelMeta,
  context: WorkflowContext,
  node: WorkflowNode,
  next: string | null,
): {
  branches: string[] | null;
  merges: Record<string, number> | null;
  next: string | null;
} {
  if (node.type === "parallel") {
    const region = regions.regions.get(node.id);
    if (!region || !region.merge || region.branches.length === 0)
      return { branches: null, merges: null, next };
    return {
      branches: [...region.branches],
      merges: { ...(context.merges ?? {}), [region.merge]: region.branches.length },
      next: region.branches[0],
    };
  }
  if (node.type === "merge" || (context.branches?.length ?? 0) === 0)
    return { branches: null, merges: null, next };
  const active = (context.branches ?? []).filter((id) => id !== node.id);
  const merges = { ...(context.merges ?? {}) };
  const owner = regions.owner.get(node.id);
  if (owner && next !== null) {
    const region = regions.regions.get(owner);
    if (region?.merge && next === region.merge) {
      const left = (merges[region.merge] ?? 1) - 1;
      if (left <= 0) {
        delete merges[region.merge];
        return { branches: [...active, region.merge], merges, next };
      }
      merges[region.merge] = left;
      return { branches: active, merges, next };
    }
    active.push(next);
    return { branches: active, merges, next };
  }
  if (next !== null) active.push(next);
  return { branches: active, merges, next };
}

/**
 * Records the failure as a job output and advances to the default forward
 * edge instead of failing the execution. The failed side effect was rolled
 * back with its checkpoint, so resuming never replays a partial write.
 */
async function continueAfterError(
  db: D1Database,
  run: ExecutionRow,
  node: WorkflowNode,
  context: WorkflowContext,
  token: string,
  now: number,
  message: string,
  meta: GraphMeta | null,
) {
  let target = defaultContinueTarget(node);
  let loops: Record<string, { index: number; delayed?: boolean }> = {
    ...(context.loops ?? {}),
  };
  let base: WorkflowContext = context;
  let steps = { ...context.steps, [node.id]: { error: message } };
  let returned = context.returned;
  let calls = context.calls;
  const owner = meta?.loops.owner.get(node.id);
  if (node.type === "loop") {
    delete loops[node.id];
  } else if (owner && loops[owner] !== undefined) {
    // A failed body step keeps iterating when its default edge stays inside
    // the body; leaving the body abandons the loop at the break edge.
    if (target === null || !meta!.loops.sets.get(owner)!.has(target)) {
      if (target === null) target = meta!.loops.heads.get(owner)!.next ?? null;
      delete loops[owner];
    }
  }
  let branches = context.branches;
  let merges = context.merges;
  if (node.type !== "parallel" && meta) {
    const routing = routeParallelFinish(meta.parallel, context, node, target);
    target = routing.next;
    branches = routing.branches ?? undefined;
    merges = routing.merges ?? undefined;
  }
  if (target === null && (calls?.length ?? 0) > 0) {
    // Continuing past a chain end inside a subflow returns partial results.
    const frame = calls![calls!.length - 1];
    const output = { steps: context.steps, partial: true };
    base = frame.saved;
    steps = { ...frame.saved.steps, [frame.returnNode]: output };
    returned = { ...(frame.saved.returned ?? {}), [frame.returnNode]: output };
    loops = { ...(frame.saved.loops ?? {}) };
    branches = frame.saved.branches;
    merges = frame.saved.merges;
    calls = calls!.slice(0, -1);
    target = frame.returnNode;
  }
  const updated: WorkflowContext = {
    ...base,
    steps,
    ...(Object.keys(loops).length > 0 ? { loops } : {}),
    ...(returned ? { returned } : {}),
    ...(calls ? { calls } : {}),
    ...(branches?.length ? { branches } : {}),
    ...(merges && Object.keys(merges).length > 0 ? { merges } : {}),
  };
  const g = guard(
    db,
    "SELECT EXISTS(SELECT 1 FROM workflow_executions WHERE workspace_id=? AND id=? AND status='running' AND lease_token=? AND lease_until>?)",
    [run.workspace_id, run.id, token, Date.now()],
  );
  if (json(updated).length > 256000) {
    await transaction(db, [
      g.start,
      db
        .prepare(
          "UPDATE workflow_executions SET status='failed',error=?,wake_at=?,lease_token=NULL,updated_at=CURRENT_TIMESTAMP WHERE workspace_id=? AND id=?",
        )
        .bind(message, now + run.attempts * 5000, run.workspace_id, run.id),
      g.end,
    ]);
    return;
  }
  await transaction(db, [
    g.start,
    db
      .prepare(
        "INSERT INTO workflow_jobs(workspace_id,execution_id,node_id,sequence,type,input,output,attempts,invocation) VALUES (?,?,?,?,?,?,?,?,(SELECT COALESCE(MAX(invocation),0)+1 FROM workflow_jobs WHERE workspace_id=? AND execution_id=?))",
      )
      .bind(
        run.workspace_id,
        run.id,
        node.id,
        Object.keys(context.steps).length,
        node.type,
        json(node),
        json({ error: message }),
        run.attempts,
        run.workspace_id,
        run.id,
      ),
    db
      .prepare(
        "UPDATE workflow_executions SET node_id=?,context=?,status=?,wake_at=0,attempts=0,error=NULL,lease_token=NULL,updated_at=CURRENT_TIMESTAMP WHERE workspace_id=? AND id=?",
      )
      .bind(
        branches?.length ? branches[0] : target,
        json(updated),
        branches?.length || target ? "queued" : "completed",
        run.workspace_id,
        run.id,
      ),
    g.end,
  ]);
}

async function executeNode(
  db: D1Database,
  run: ExecutionRow,
  node: WorkflowNode,
  context: WorkflowContext,
  token: string,
  now: number,
  meta: GraphMeta,
  webhooks: WebhookDependencies = {},
  pieces: WorkflowPieceHandler[] = resolveWorkflowPieces(),
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
  let frameOp:
    | { id: string; index: number; delayed?: boolean }
    | { id: string; drop: true }
    | null = null;
  const finish = (output: unknown, unmark?: string) => {
    const owner = meta.loops.owner.get(node.id);
    const active = owner ? context.loops?.[owner] : undefined;
    if (owner && active !== undefined && frameOp === null) {
      const members = meta.loops.sets.get(owner)!;
      if (next === null) {
        if (node.type === "delay" && !active.delayed) {
          // Wait first; the resume pass iterates. The frame stays.
          next = node.id;
          frameOp = { id: owner, index: active.index, delayed: true };
        } else {
          const head = meta.loops.heads.get(owner)!;
          const raw = resolveWorkflowValue(head.items, context);
          if (!Array.isArray(raw))
            throw new Error("Loop source changed during iteration");
          const total = Math.min(raw.length, head.maxIterations ?? 100);
          const advanced = active.index + 1;
          if (advanced < total) {
            frameOp = { id: owner, index: advanced };
            next = owner;
          } else {
            frameOp = { id: owner, drop: true };
            next = head.next ?? null;
          }
        }
      } else if (!members.has(next)) {
        frameOp = { id: owner, drop: true };
      }
    }
    const parallel = routeParallelFinish(meta.parallel, context, node, next);
    next = parallel.next;
    const returning = next === null && (context.calls?.length ?? 0) > 0;
    if (returning && node.type === "delay") {
      // Wait first; the resume pass returns. The call stack stays.
      next = node.id;
    }
    const loops = { ...(context.loops ?? {}) };
    if (frameOp) {
      if ("drop" in frameOp) delete loops[frameOp.id];
      else
        loops[frameOp.id] = { index: frameOp.index, delayed: frameOp.delayed };
    }
    let returned = context.returned;
    if (unmark && returned) {
      const { [unmark]: _dropped, ...keep } = returned;
      returned = Object.keys(keep).length > 0 ? keep : undefined;
    }
    const updated: WorkflowContext = {
      ...context,
      steps: { ...context.steps, [node.id]: output },
      ...(Object.keys(loops).length > 0 ? { loops } : {}),
      ...(unmark ? { returned } : {}),
      branches: parallel.branches ?? undefined,
      merges: parallel.merges ?? undefined,
    };
    if (json(updated).length > 256000)
      throw new Error("Execution context exceeds 256 KB");
    return [
      db
        .prepare(
          "INSERT INTO workflow_jobs(workspace_id,execution_id,node_id,sequence,type,input,output,attempts,invocation) VALUES (?,?,?,?,?,?,?,?,(SELECT COALESCE(MAX(invocation),0)+1 FROM workflow_jobs WHERE workspace_id=? AND execution_id=?))",
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
          run.workspace_id,
          run.id,
        ),
      db
        .prepare(
          "UPDATE workflow_executions SET node_id=?,context=?,status=?,wake_at=?,attempts=0,error=NULL,lease_token=NULL,updated_at=CURRENT_TIMESTAMP WHERE workspace_id=? AND id=?",
        )
        .bind(
          parallel.branches?.length ? parallel.branches[0] : next,
          json(updated),
          node.type === "delay"
            ? "waiting"
            : parallel.branches?.length || next !== null || returning
              ? "queued"
              : "completed",
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
          "SELECT record_id FROM studio_unique_values WHERE tenant_id=? AND object_name=? AND field_name=? AND value=?",
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
  if (node.type === "bulkUpdate") {
    const raw = value(node.items);
    if (!Array.isArray(raw))
      throw new Error("Bulk update requires a list of records");
    if (raw.length > 100)
      throw new Error("Bulk update is limited to 100 records");
    const ids: string[] = [];
    for (const element of raw) {
      const id =
        typeof element === "string"
          ? element
          : (element as { id?: unknown } | null)?.id;
      if (typeof id !== "string" || !id)
        throw new Error("Bulk update items must include a record id");
      // Each write is fenced by a fresh lease guard and tracked for causation,
      // but only the final summary checkpoints this execution forward.
      const fenced = guard(
        db,
        "SELECT EXISTS(SELECT 1 FROM workflow_executions WHERE workspace_id=? AND id=? AND status='running' AND lease_token=? AND lease_until>?)",
        [run.workspace_id, run.id, token, Date.now()],
      );
      const record = await getRecord(db, run.workspace_id, node.collection, id);
      const itemValues = Object.fromEntries(
        Object.entries(node.values).map(([field, fieldValue]) => [
          field,
          resolveWorkflowValue(fieldValue, { ...context, item: element }),
        ]),
      );
      await updateRecord(
        db,
        run.workspace_id,
        node.collection,
        id,
        itemValues,
        {
          version: record._version!,
          checkpoint: {
            before: [
              fenced.start,
              db
                .prepare(
                  "INSERT INTO workflow_write_context(workspace_id,record_id,depth,cause) VALUES (?,?,?,?)",
                )
                .bind(run.workspace_id, id, run.depth + 1, run.id),
            ],
            after: () => [
              db
                .prepare(
                  "DELETE FROM workflow_write_context WHERE workspace_id=? AND record_id=?",
                )
                .bind(run.workspace_id, id),
              fenced.end,
            ],
          },
        },
      );
      ids.push(id);
    }
    await transaction(db, [g.start, ...finish({ updated: ids.length, ids })]);
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
    case "switch": {
      const input = value(node.input);
      let matched: number | null = null;
      for (let index = 0; index < node.cases.length; index++) {
        const entry = node.cases[index];
        if (
          matchWorkflowSwitchCase(entry.operator, input, value(entry.value))
        ) {
          matched = index;
          next = entry.next ?? null;
          break;
        }
      }
      if (matched === null) next = node.otherwise ?? null;
      output = {
        value: input,
        matched,
        branch:
          matched !== null
            ? node.cases[matched].next
            : (node.otherwise ?? null),
      };
      break;
    }
    case "transform":
      output = mapped(node.values);
      break;
    case "parallel": {
      const region = meta.parallel.regions.get(node.id);
      output = {
        branches: region?.branches ?? [],
        count: region?.branches.length ?? 0,
      };
      break;
    }
    case "merge": {
      const ends =
        [...meta.parallel.regions.values()].find(
          (region) => region.merge === node.id,
        )?.ends ?? [];
      const reached = ends.filter((end) => end in context.steps);
      output = {
        branches: Object.fromEntries(
          reached.map((end) => [end, context.steps[end]]),
        ),
        count: reached.length,
      };
      break;
    }
    case "approval": {
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
        throw new Error("Approval requires a title and assignee");
      const description =
        node.description === undefined ? null : value(node.description);
      if (description !== null && typeof description !== "string")
        throw new Error("Approval description must be text");
      const loopOwner = meta.loops.owner.get(node.id);
      const iteration = loopOwner
        ? (context.loops?.[loopOwner]?.index ?? 0)
        : 0;
      const dueAt = now + node.dueDays * 86400000;
      const request = await db
        .prepare(
          "SELECT * FROM workflow_approvals WHERE workspace_id=? AND execution_id=? AND node_id=? AND iteration=?",
        )
        .bind(run.workspace_id, run.id, node.id, iteration)
        .first<{
          id: string;
          title: string;
          assignee: string;
          status: string;
          decision: string | null;
          comment: string | null;
          decided_by: string | null;
          decided_at: number | null;
          due_at: number;
        }>();
      const suspend = (wakeAt: number) =>
        db
          .prepare(
            "UPDATE workflow_executions SET node_id=?,status='waiting',wake_at=?,attempts=0,error=NULL,lease_token=NULL,updated_at=CURRENT_TIMESTAMP WHERE workspace_id=? AND id=?",
          )
          .bind(node.id, wakeAt, run.workspace_id, run.id);
      if (!request) {
        const id = crypto.randomUUID();
        await transaction(db, [
          g.start,
          db
            .prepare(
              "INSERT INTO workflow_approvals(workspace_id,id,execution_id,node_id,title,assignee,due_at,iteration) VALUES (?,?,?,?,?,?,?,?)",
            )
            .bind(
              run.workspace_id,
              id,
              run.id,
              node.id,
              title,
              assignee,
              dueAt,
              iteration,
            ),
          suspend(dueAt),
          g.end,
        ]);
        return;
      }
      if (request.status === "open") {
        if (now < request.due_at) {
          await transaction(db, [g.start, suspend(request.due_at), g.end]);
          return;
        }
        next = node.otherwise ?? null;
        await transaction(db, [
          g.start,
          db
            .prepare(
              "UPDATE workflow_approvals SET status='expired' WHERE workspace_id=? AND id=? AND status='open'",
            )
            .bind(run.workspace_id, request.id),
          ...finish({
            decision: "expired",
            by: null,
            comment: null,
            decidedAt: null,
          }),
        ]);
        return;
      }
      output = {
        decision: request.decision,
        by: request.decided_by,
        comment: request.comment,
        decidedAt:
          request.decided_at != null
            ? new Date(request.decided_at).toISOString()
            : null,
      };
      next =
        request.decision === "approved"
          ? (node.next ?? null)
          : (node.otherwise ?? null);
      break;
    }
    case "piece": {
      const piece = findWorkflowPiece(pieces, node.pieceId, node.pieceVersion);
      output = await executeWorkflowPiece(piece, node.config ?? {}, value, {
        db,
        workspace: run.workspace_id,
        owner: run.owner_id,
        executionId: run.id,
        nodeId: node.id,
        fetch: webhooks.fetcher ?? fetch,
        now,
      });
      break;
    }
    case "subflow": {
      if (context.returned && Object.hasOwn(context.returned, node.id)) {
        output = (context.returned as Record<string, unknown>)[node.id];
        await transaction(db, [g.start, ...finish(output, node.id)]);
        return;
      }
      const calls = context.calls ?? [];
      const chain = [run.workflow_id, ...calls.map((call) => call.child)];
      if (chain.includes(node.workflowId))
        fail("Subflow recursion detected", 422);
      if (calls.length >= 5) fail("Subflow depth exceeded", 422);
      const child = await db
        .prepare(
          "SELECT definition FROM workflow_versions WHERE workspace_id=? AND id=? AND workflow_id=?",
        )
        .bind(run.workspace_id, node.workflowVersion, node.workflowId)
        .first<{ definition: string }>();
      if (!child) fail("Pinned subflow version is missing", 422);
      const childDefinition = workflowDefinitionSchema.parse(
        JSON.parse(child.definition),
      );
      if (childDefinition.nodes.length === 0) fail("Subflow has no steps", 422);
      const input = Object.fromEntries(
        Object.entries(node.input ?? {}).map(([field, fieldValue]) => [
          field,
          value(fieldValue),
        ]),
      );
      if (JSON.stringify(input).length > 32000)
        fail("Subflow input exceeds 32 KiB", 422);
      const system = context.system;
      const childContext: WorkflowContext = {
        trigger: input as Record<string, unknown>,
        before: {},
        steps: {},
        system: {
          owner: system.owner,
          workspace: system.workspace,
          ...(system.initiator !== undefined
            ? { initiator: system.initiator }
            : {}),
        },
      };
      const updated: WorkflowContext = {
        ...childContext,
        calls: [
          ...calls,
          {
            child: node.workflowId,
            version: node.workflowVersion,
            returnNode: node.id,
            saved: context,
          },
        ],
      };
      if (JSON.stringify(updated).length > 256000)
        throw new Error("Execution context exceeds 256 KB");
      await transaction(db, [
        g.start,
        db
          .prepare(
            "INSERT INTO workflow_jobs(workspace_id,execution_id,node_id,sequence,type,input,output,attempts,invocation) VALUES (?,?,?,?,?,?,?,?,(SELECT COALESCE(MAX(invocation),0)+1 FROM workflow_jobs WHERE workspace_id=? AND execution_id=?))",
          )
          .bind(
            run.workspace_id,
            run.id,
            node.id,
            Object.keys(context.steps).length,
            node.type,
            json(node),
            json({
              child: node.workflowId,
              version: node.workflowVersion,
              started: true,
            }),
            run.attempts,
            run.workspace_id,
            run.id,
          ),
        db
          .prepare(
            "UPDATE workflow_executions SET node_id=?,context=?,status='queued',wake_at=0,attempts=0,error=NULL,lease_token=NULL,updated_at=CURRENT_TIMESTAMP WHERE workspace_id=? AND id=?",
          )
          .bind(
            childDefinition.nodes[0].id,
            json(updated),
            run.workspace_id,
            run.id,
          ),
        g.end,
      ]);
      return;
    }
    case "http": {
      const rawUrl = value(node.url);
      if (typeof rawUrl !== "string" || !rawUrl)
        fail("HTTP URL must resolve to text", 422);
      const credential = node.destinationId
        ? await new WebhookDestinationRepository(
            db,
            run.workspace_id,
            webhooks,
          ).resolve(node.destinationId, node.destinationRevision!)
        : {
            authType: "none" as const,
            authHeader: undefined,
            secret: undefined,
          };
      const scalar = (
        name: string,
        fieldValue: Parameters<typeof resolveWorkflowValue>[0],
      ) => {
        const resolved = value(fieldValue);
        if (resolved === null) return undefined;
        if (
          typeof resolved !== "string" &&
          typeof resolved !== "number" &&
          typeof resolved !== "boolean"
        )
          fail(`HTTP field ${name} must be scalar`, 422);
        return String(resolved);
      };
      const headers: Record<string, string> = {};
      for (const [name, fieldValue] of Object.entries(node.headers ?? {})) {
        const resolved = scalar(name, fieldValue);
        if (resolved !== undefined) headers[name] = resolved;
      }
      const query: Record<string, string> = {};
      for (const [name, fieldValue] of Object.entries(node.query ?? {})) {
        const resolved = scalar(name, fieldValue);
        if (resolved !== undefined) query[name] = resolved;
      }
      const result = await sendWorkflowHttpRequest(
        {
          method: node.method,
          url: rawUrl,
          headers,
          query,
          body: node.body ? JSON.stringify(mapped(node.body)) : undefined,
          authType: credential.authType,
          authHeader: credential.authHeader,
          secret: credential.secret,
        },
        webhooks,
      );
      if (
        result.status !== null &&
        result.status >= 200 &&
        result.status < 300 &&
        result.output
      ) {
        output = result.output;
        break;
      }
      if (result.retryable)
        throw new Error(result.error ?? "HTTP request failed");
      throw fail(result.error ?? "HTTP request failed", 422);
    }
    case "loop": {
      if (node.body === node.next)
        throw new Error("Loop body must differ from its post-loop step");
      const raw = value(node.items);
      if (!Array.isArray(raw)) throw new Error("Loop requires a list");
      if (raw.length > 100) throw new Error("Loop is limited to 100 items");
      const total = Math.min(raw.length, node.maxIterations ?? 100);
      const index = context.loops?.[node.id]?.index ?? 0;
      if (index < total) {
        output = { count: raw.length, index, item: raw[index] };
        next = node.body;
        frameOp = { id: node.id, index };
      } else {
        output = { count: raw.length, iterations: index };
        next = node.next ?? null;
        frameOp = { id: node.id, drop: true };
      }
      break;
    }
    case "map": {
      const raw = value(node.items);
      if (!Array.isArray(raw)) throw new Error("List mapping requires a list");
      if (raw.length > 100)
        throw new Error("List mapping is limited to 100 items");
      output = {
        items: raw.map((item) =>
          Object.fromEntries(
            Object.entries(node.values).map(([field, fieldValue]) => [
              field,
              resolveWorkflowValue(fieldValue, { ...context, item }),
            ]),
          ),
        ),
        count: raw.length,
      };
      break;
    }
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
          `SELECT * FROM studio_records WHERE tenant_id=? AND object_name=? AND deleted_at IS NULL AND ${comparison.sql} LIMIT ?`,
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
      const loopOwner = meta.loops.owner.get(node.id);
      const iteration = loopOwner
        ? (context.loops?.[loopOwner]?.index ?? 0)
        : 0;
      effects.push(
        db
          .prepare(
            "INSERT INTO workflow_tasks(workspace_id,id,execution_id,node_id,kind,title,assignee,due_at,iteration) VALUES (?,?,?,?,?,?,?,?,?)",
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
            iteration,
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
