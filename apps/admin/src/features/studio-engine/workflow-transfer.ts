import {
  workflowDraftSchema,
  type WorkflowDefinition,
} from "@savia/studio-shared/workflows";
import { fieldEntries, type StudioObject } from "@savia/studio-shared/metadata";

export type WorkflowExport = {
  kind: "savia-workflow";
  version: 1;
  name: string;
  definition: WorkflowDefinition;
  exportedAt: string;
};

export function exportWorkflow(
  name: string,
  definition: WorkflowDefinition,
): WorkflowExport {
  return {
    kind: "savia-workflow",
    version: 1,
    name,
    definition,
    exportedAt: new Date().toISOString(),
  };
}

export function parseWorkflowImport(raw: unknown): {
  name: string;
  definition: WorkflowDefinition;
} {
  if (!raw || typeof raw !== "object") throw new Error("invalid-file");
  const file = raw as Record<string, unknown>;
  if (file.kind !== "savia-workflow" || file.version !== 1)
    throw new Error("invalid-file");
  const parsed = workflowDraftSchema.safeParse({
    name: file.name,
    definition: file.definition,
  });
  if (!parsed.success) throw new Error("invalid-definition");
  return parsed.data;
}

export type WorkflowImportAudit = {
  missingCollections: string[];
  unknownFields: string[];
  externalRefs: string[];
};

/**
 * Pre-flight check against the workspace collections. Missing collections or
 * fields block the import; subflow and destination references only warn
 * because they are re-linked in this workspace before publishing. Piece
 * pins resolve against the live catalog at publication.
 */
export function auditWorkflowImport(
  definition: WorkflowDefinition,
  objects: StudioObject[],
): WorkflowImportAudit {
  const missingCollections: string[] = [],
    unknownFields: string[] = [],
    externalRefs: string[] = [];
  const fieldsOf = (collection: string): Set<string> | null => {
    const object = objects.find((entry) => entry.name === collection);
    if (!object) {
      if (!missingCollections.includes(collection))
        missingCollections.push(collection);
      return null;
    }
    return new Set(fieldEntries(object).map(([name]) => name));
  };
  const checkFields = (
    collection: string,
    location: string,
    names: string[],
  ) => {
    const fields = fieldsOf(collection);
    if (!fields) return;
    for (const name of names)
      if (name !== "id" && !fields.has(name))
        unknownFields.push(`${location}: ${name}`);
  };
  const trigger = definition.trigger;
  if ("collection" in trigger && trigger.collection) {
    fieldsOf(trigger.collection);
    if ("conditions" in trigger && trigger.conditions)
      checkFields(
        trigger.collection,
        trigger.collection,
        trigger.conditions.map((condition) => condition.field),
      );
    if ("changedFields" in trigger && trigger.changedFields)
      checkFields(
        trigger.collection,
        trigger.collection,
        trigger.changedFields,
      );
  }
  for (const node of definition.nodes) {
    if (node.type === "query") {
      fieldsOf(node.collection);
      checkFields(node.collection, node.collection, [node.field]);
    } else if (node.type === "create") {
      fieldsOf(node.collection);
      checkFields(node.collection, node.collection, [
        ...Object.keys(node.values),
        ...(node.matchField ? [node.matchField] : []),
      ]);
    } else if (node.type === "update") {
      fieldsOf(node.collection);
      checkFields(node.collection, node.collection, Object.keys(node.values));
    } else if (node.type === "bulkUpdate") {
      fieldsOf(node.collection);
      checkFields(node.collection, node.collection, Object.keys(node.values));
    } else if (node.type === "subflow") {
      externalRefs.push(`subflow:${node.workflowId}`);
    } else if (node.type === "webhook" || node.type === "http") {
      if ("destinationId" in node && node.destinationId)
        externalRefs.push(`destination:${node.destinationId}`);
    }
  }
  return {
    missingCollections,
    unknownFields: [...new Set(unknownFields)],
    externalRefs: [...new Set(externalRefs)],
  };
}
