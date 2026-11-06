import type { Edge, Connection } from "@xyflow/react";
import type {
  WorkflowDefinition,
  WorkflowNode,
} from "@savia/studio-shared/workflows";

export type NativeDefinition = WorkflowDefinition & {
  positions?: Record<string, { x: number; y: number }>;
};

export type NativeEdge = Edge<{ label: string }>;
export type NodePosition = { x: number; y: number };

export function setNativePositions(
  definition: NativeDefinition,
  positions: Record<string, NodePosition>,
): NativeDefinition {
  return { ...definition, positions };
}

export function graphEdges(definition: WorkflowDefinition): NativeEdge[] {
  return definition.nodes.flatMap((node) => {
    const edges: NativeEdge[] = [];
    if (node.next) {
      const isBranch = node.type === "condition";
      edges.push({
        id: `${node.id}:${isBranch ? "true" : "next"}:${node.next}`,
        source: node.id,
        target: node.next,
        ...(isBranch
          ? { sourceHandle: "true", label: "True" }
          : { label: "Next" }),
        type: "smoothstep",
      });
    }
    if (node.type === "condition" && node.otherwise) {
      edges.push({
        id: `${node.id}:false:${node.otherwise}`,
        source: node.id,
        sourceHandle: "false",
        target: node.otherwise,
        label: "False",
        type: "smoothstep",
      });
    }
    return edges;
  });
}

function outgoing(node: WorkflowNode): string[] {
  return [
    node.next,
    ...(node.type === "condition" ? [node.otherwise] : []),
  ].filter((target): target is string => Boolean(target));
}

function hasCycle(nodes: WorkflowNode[]): boolean {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const target of outgoing(byId.get(id)!)) {
      if (!byId.has(target) || visit(target)) return true;
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  return nodes.some((node) => visit(node.id));
}

function replaceBranch(
  definition: WorkflowDefinition,
  connection: Connection,
): WorkflowNode[] | null {
  if (!connection.source || !connection.target) return null;
  const source = definition.nodes.find((node) => node.id === connection.source);
  if (
    !source ||
    !definition.nodes.some((node) => node.id === connection.target)
  )
    return null;
  if (source.type === "condition") {
    if (
      connection.sourceHandle !== "true" &&
      connection.sourceHandle !== "false"
    )
      return null;
    return definition.nodes.map((node) =>
      node.id !== source.id
        ? node
        : connection.sourceHandle === "true"
          ? { ...node, next: connection.target! }
          : { ...node, otherwise: connection.target! },
    );
  }
  if (connection.sourceHandle && connection.sourceHandle !== "next")
    return null;
  return definition.nodes.map((node) =>
    node.id === source.id
      ? ({ ...node, next: connection.target! } as WorkflowNode)
      : node,
  );
}

export function canConnectNativeNodes(
  definition: WorkflowDefinition,
  connection: Connection,
): boolean {
  const nodes = replaceBranch(definition, connection);
  return Boolean(nodes && !hasCycle(nodes));
}

export function connectNativeNodes(
  definition: WorkflowDefinition,
  connection: Connection,
): WorkflowDefinition {
  const nodes = replaceBranch(definition, connection);
  if (!nodes || hasCycle(nodes)) return definition;
  return { ...definition, nodes };
}

export function disconnectNativeEdge(
  definition: WorkflowDefinition,
  source: string,
  sourceHandle: string | null,
): WorkflowDefinition {
  return {
    ...definition,
    nodes: definition.nodes.map((node) => {
      if (node.id !== source) return node;
      if (node.type === "condition" && sourceHandle === "false") {
        const { otherwise: _otherwise, ...rest } = node;
        return rest;
      }
      const { next: _next, ...rest } = node;
      return rest as WorkflowNode;
    }),
  };
}

export function removeNativeNode(
  definition: WorkflowDefinition,
  nodeId: string,
): WorkflowDefinition | null {
  const removed = definition.nodes.find((node) => node.id === nodeId);
  if (!removed || definition.nodes.length <= 1) return null;
  const primaryNext =
    removed.next ??
    (removed.type === "condition" ? removed.otherwise : undefined);
  if (
    nodeId === definition.nodes[0].id &&
    removed.type === "condition" &&
    removed.next &&
    removed.otherwise &&
    removed.next !== removed.otherwise
  )
    return null;
  const nodes = definition.nodes
    .filter((node) => node.id !== nodeId)
    .map((node) => ({
      ...node,
      ...(node.next === nodeId ? { next: primaryNext } : {}),
      ...(node.type === "condition" && node.otherwise === nodeId
        ? { otherwise: primaryNext }
        : {}),
    }));
  if (nodeId === definition.nodes[0].id) {
    const entry = primaryNext;
    if (!entry) return null;
    const entryIndex = nodes.findIndex((node) => node.id === entry);
    if (entryIndex < 0) return null;
    nodes.unshift(...nodes.splice(entryIndex, 1));
  }
  const positions = { ...(definition as NativeDefinition).positions };
  delete positions[nodeId];
  return {
    ...definition,
    nodes,
    ...(Object.keys(positions).length ? { positions } : {}),
  } as WorkflowDefinition;
}
