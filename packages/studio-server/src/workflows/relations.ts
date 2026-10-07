import {
  fieldEntries,
  type StudioObject,
} from "@savia/studio-shared/metadata";
import {
  recordMatchesConditions,
  workflowDefinitionSchema,
  type WorkflowContext,
  type WorkflowDefinition,
  type WorkflowTriggerCondition,
} from "@savia/studio-shared/workflows";
import { fail } from "../context";

async function getWorkflowObject(
  db: D1Database,
  workspace: string,
  name: string,
): Promise<StudioObject | null> {
  const row = await db
    .prepare("SELECT * FROM studio_objects WHERE tenant_id=? AND name=?")
    .bind(workspace, name)
    .first<{ config: string } & Record<string, unknown>>();
  if (!row) return null;
  try {
    return { ...row, config: JSON.parse(row.config) } as StudioObject;
  } catch {
    return null;
  }
}

export type ValidateTrigger = {
  collection: string;
  conditions?: WorkflowTriggerCondition[];
  conditionMode?: "all" | "any";
  changedFields?: string[];
};

async function recordSnapshot(
  db: D1Database,
  workspace: string,
  collection: string,
  id: string,
): Promise<Record<string, unknown> | null> {
  const row = await db
    .prepare(
      "SELECT id,data FROM studio_records WHERE tenant_id=? AND object_name=? AND id=? AND deleted_at IS NULL",
    )
    .bind(workspace, collection, id)
    .first<{ id: string; data: string }>();
  if (!row) return null;
  try {
    return { ...(JSON.parse(row.data) as Record<string, unknown>), id: row.id };
  } catch {
    return null;
  }
}

/**
 * Single-level relation preload for workflow snapshots. Relation fields
 * holding a record id gain a `related.<field>` snapshot; multiple-valued
 * relations and missing targets are skipped. Never mutates the input.
 */
export async function preloadRelatedSnapshots(
  db: D1Database,
  workspace: string,
  collection: string,
  snapshot: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const object = await getWorkflowObject(db, workspace, collection);
  if (!object) return snapshot;
  const related: Record<string, unknown> = {};
  for (const [name, field] of fieldEntries(object)) {
    const target = field.config?.relation;
    if (!target || target === collection) continue;
    if (field.config?.multiple) continue;
    const id = snapshot[name];
    if (typeof id !== "string" || !id) continue;
    if (name === "related") continue;
    const targetSnapshot = await recordSnapshot(
      db,
      workspace,
      String(target),
      id,
    );
    if (targetSnapshot) related[name] = targetSnapshot;
  }
  if (Object.keys(related).length === 0) return snapshot;
  return { ...snapshot, related };
}

function changed(
  before: Record<string, unknown> | null,
  after: Record<string, unknown>,
  watched: string[],
): boolean {
  if (!before || watched.length === 0) return true;
  return watched.some(
    (field) =>
      JSON.stringify(before[field]) !== JSON.stringify(after[field]) ||
      typeof before[field] !== typeof after[field],
  );
}

/**
 * Synchronous pre-save gate. Published, enabled `validate` flows describe
 * forbidden states: when every (or any, per mode) condition matches the
 * about-to-write snapshot, the write is rejected before the transaction.
 * Returns the blocking workflow for the error message, or null to proceed.
 */
export async function validateWorkflowsForWrite(
  db: D1Database,
  workspace: string,
  collection: string,
  snapshot: Record<string, unknown>,
  before: Record<string, unknown> | null,
): Promise<{ id: string; name: string } | null> {
  let rows: { workspace_id: string; id: string; name: string; definition: string }[];
  try {
    rows = (
      await db
        .prepare(
          "SELECT w.workspace_id,w.id,w.name,v.definition FROM workflows w JOIN workflow_versions v ON v.workspace_id=w.workspace_id AND v.id=w.published_version WHERE w.workspace_id=? AND w.enabled=1",
        )
        .bind(workspace)
        .all<{
          workspace_id: string;
          id: string;
          name: string;
          definition: string;
        }>()
    ).results;
  } catch {
    return null;
  }
  const enriched = await preloadRelatedSnapshots(
    db,
    workspace,
    collection,
    snapshot,
  );
  for (const row of rows) {
    let definition;
    try {
      definition = workflowDefinitionSchema.parse(JSON.parse(row.definition));
    } catch {
      continue;
    }
    if (definition.trigger.type !== "validate") continue;
    if (definition.trigger.collection !== collection) continue;
    if (!changed(before, enriched, definition.trigger.changedFields ?? []))
      continue;
    if (
      recordMatchesConditions(
        definition.trigger.conditions,
        definition.trigger.conditionMode,
        enriched,
      )
    )
      return { id: row.id, name: row.name };
  }
  return null;
}

/** Runs the pre-save gate; fails the write with 422 when a flow blocks it. */
export async function enforceValidationWorkflows(
  db: D1Database,
  workspace: string,
  collection: string,
  snapshot: Record<string, unknown>,
  before: Record<string, unknown> | null,
): Promise<void> {
  const blocking = await validateWorkflowsForWrite(
    db,
    workspace,
    collection,
    snapshot,
    before,
  );
  if (blocking)
    fail(`Validación del flujo "${blocking.name}": el registro no cumple las condiciones.`, 422);
}

export function definitionNeedsRelations(definition: WorkflowDefinition): boolean {
  return JSON.stringify(definition).includes(".related.");
}

/**
 * One-time relation preload for collection-event executions. Attaches
 * `related.<field>` snapshots to `trigger` (and `before` when present) the
 * first time a step runs; later checkpoints already carry the data.
 */
export async function enrichExecutionContext(
  db: D1Database,
  workspace: string,
  definition: WorkflowDefinition,
  context: WorkflowContext,
): Promise<WorkflowContext> {
  const trigger = definition.trigger;
  if (
    trigger.type !== "created" &&
    trigger.type !== "updated" &&
    trigger.type !== "created_or_updated" &&
    trigger.type !== "deleted" &&
    trigger.type !== "validate"
  )
    return context;
  if (!("collection" in trigger) || !trigger.collection) return context;
  if (!definitionNeedsRelations(definition)) return context;
  const snapshot = context.trigger as Record<string, unknown> | undefined;
  if (!snapshot || typeof snapshot !== "object" || snapshot.related)
    return context;
  const enriched = await preloadRelatedSnapshots(
    db,
    workspace,
    trigger.collection,
    snapshot,
  );
  if (enriched === snapshot) return context;
  const before = context.before as Record<string, unknown> | undefined;
  const enrichedBefore =
    before && typeof before === "object" && !before.related
      ? await preloadRelatedSnapshots(db, workspace, trigger.collection, before)
      : undefined;
  return {
    ...context,
    trigger: enriched,
    ...(enrichedBefore ? { before: enrichedBefore } : {}),
  };
}
