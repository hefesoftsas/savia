import type { Node, NodeType, WorkflowTrigger } from "@savia/flows-types";
import { buildTriggerNodes } from "@savia/flows-utils";

import { createNodeId } from "./graph-ids";

export {
  ALL_TRIGGER_NODE_TYPE_IDS,
  getTriggerNodeTypes,
  TRIGGER_TO_NODE_TYPES,
} from "@savia/flows-utils";

/**
 * Builds initial `Node` objects for a given trigger type. Thin wrapper over the
 * shared helper that supplies the app's node-id scheme.
 */
export function buildInitialTriggerNodes(
  trigger: WorkflowTrigger,
  nodeTypes: NodeType[]
): Node[] {
  return buildTriggerNodes(trigger, nodeTypes, {
    idFor: (nodeType) => createNodeId(nodeType.type),
  });
}
