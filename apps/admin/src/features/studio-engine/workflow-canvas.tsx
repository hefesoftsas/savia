import { useEffect, useMemo, useState } from "react";
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeChange,
  type NodeProps,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useMessages } from "@/i18n/core";
import { automationMessages } from "@/i18n/locales/automation";
import type {
  WorkflowDefinition,
  WorkflowNode,
} from "@savia/studio-shared/workflows";
import { stepLabels } from "./workflow-editor";

export const TRIGGER_NODE_ID = "__trigger__";
const START_HANDLE = "start";
const TARGET_HANDLE = "in";

type EdgeText = {
  start: string;
  yes: string;
  no: string;
  approved: string;
  rejected: string;
  defect: string;
  body: string;
  stepCase: (index: number) => string;
  branch: (index: number) => string;
};

function edgePairs(definition: WorkflowDefinition): [string, string][] {
  const ids = new Set(definition.nodes.map((node) => node.id));
  const pairs: [string, string][] = [];
  const first = definition.nodes[0]?.id;
  if (first) pairs.push([TRIGGER_NODE_ID, first]);
  for (const node of definition.nodes) {
    const targets: (string | undefined)[] =
      node.type === "condition" || node.type === "approval"
        ? [node.next, node.otherwise]
        : node.type === "parallel"
          ? node.branches
          : node.type === "switch"
            ? [...node.cases.map((entry) => entry.next), node.otherwise]
            : node.type === "loop"
              ? [node.body, node.next]
              : [node.next];
    for (const target of targets)
      if (target && ids.has(target)) pairs.push([node.id, target]);
  }
  return pairs;
}

/** Longest-path layers from the trigger. Bounded rounds, so invalid drafts with cycles still render. */
export function layoutWorkflow(
  definition: WorkflowDefinition,
): Record<string, { x: number; y: number }> {
  const order = [TRIGGER_NODE_ID, ...definition.nodes.map((node) => node.id)];
  const pairs = edgePairs(definition);
  const depth = new Map<string, number>([[TRIGGER_NODE_ID, 0]]);
  for (let round = 0; round <= definition.nodes.length; round++)
    for (const [source, target] of pairs)
      if (depth.has(source))
        depth.set(
          target,
          Math.max(depth.get(target) ?? -1, depth.get(source)! + 1),
        );
  const maxDepth = Math.max(0, ...depth.values());
  for (const id of order) if (!depth.has(id)) depth.set(id, maxDepth + 1);
  const slots = new Map<number, number>(),
    positions: Record<string, { x: number; y: number }> = {};
  for (const id of order) {
    const layer = depth.get(id)!,
      slot = slots.get(layer) ?? 0;
    slots.set(layer, slot + 1);
    positions[id] = { x: layer * 300, y: slot * 170 };
  }
  return positions;
}

export function buildWorkflowEdges(
  definition: WorkflowDefinition,
  text: EdgeText,
): Pick<Edge, "id" | "source" | "target" | "sourceHandle" | "label">[] {
  const ids = new Set(definition.nodes.map((node) => node.id));
  const edges: Pick<
    Edge,
    "id" | "source" | "target" | "sourceHandle" | "label"
  >[] = [];
  const push = (
    source: string,
    target: string | undefined,
    sourceHandle: string,
    label?: string,
  ) => {
    if (target && ids.has(target))
      edges.push({
        id: `${source}>${target}:${sourceHandle}`,
        source,
        target,
        sourceHandle,
        label,
      });
  };
  const first = definition.nodes[0]?.id;
  if (first) push(TRIGGER_NODE_ID, first, START_HANDLE, text.start);
  for (const node of definition.nodes) {
    if (node.type === "condition") {
      push(node.id, node.next, "next", text.yes);
      push(node.id, node.otherwise, "otherwise", text.no);
    } else if (node.type === "approval") {
      push(node.id, node.next, "next", text.approved);
      push(node.id, node.otherwise, "otherwise", text.rejected);
    } else if (node.type === "switch") {
      node.cases.forEach((entry, index) =>
        push(node.id, entry.next, `case:${index}`, text.stepCase(index + 1)),
      );
      push(node.id, node.otherwise, "otherwise", text.defect);
    } else if (node.type === "loop") {
      push(node.id, node.body, "body", text.body);
      push(node.id, node.next, "next");
    } else if (node.type === "parallel") {
      node.branches.forEach((entry, index) =>
        push(node.id, entry, `branch:${index}`, text.branch(index + 1)),
      );
    } else if (node.next) {
      push(node.id, node.next, "next");
    }
  }
  return edges;
}
function sourceHandles(node: WorkflowNode): { id: string; label?: string }[] {
  if (node.type === "condition" || node.type === "approval")
    return [{ id: "next" }, { id: "otherwise" }];
  if (node.type === "parallel")
    return node.branches.map((_, index) => ({ id: `branch:${index}` }));
  if (node.type === "switch")
    return [
      ...node.cases.map((_, index) => ({ id: `case:${index}` })),
      { id: "otherwise" },
    ];
  if (node.type === "loop") return [{ id: "body" }, { id: "next" }];
  return [{ id: "next" }];
}

/** Maps a canvas connection onto the step definition. Null means ignore. */
export function connectStepTarget(
  node: WorkflowNode,
  sourceHandle: string | null | undefined,
  target: string,
): WorkflowNode | null {
  if (node.type === "condition" || node.type === "approval")
    return {
      ...node,
      ...(sourceHandle === "otherwise"
        ? { otherwise: target }
        : { next: target }),
    } as WorkflowNode;
  if (node.type === "switch") {
    if (sourceHandle === "otherwise") return { ...node, otherwise: target };
    const match = /^case:(\d+)$/.exec(sourceHandle ?? "");
    if (!match || !node.cases[Number(match[1])]) return null;
    const index = Number(match[1]);
    return {
      ...node,
      cases: node.cases.map((entry, i) =>
        i === index ? { ...entry, next: target } : entry,
      ),
    };
  }
  if (node.type === "loop")
    return {
      ...node,
      ...(sourceHandle === "body" ? { body: target } : { next: target }),
    };
  if (node.type === "parallel") {
    const match = /^branch:(\d+)$/.exec(sourceHandle ?? "");
    if (!match || !node.branches[Number(match[1])]) return null;
    const index = Number(match[1]);
    return {
      ...node,
      branches: node.branches.map((entry, i) => (i === index ? target : entry)),
    };
  }
  return { ...node, next: target };
}

type StepNodeData = {
  index: number;
  title: string;
  subtitle?: string;
  handles: { id: string }[];
  active: boolean;
  onSelect: (id: string) => void;
};

function WorkflowStepNode({ id, data }: NodeProps) {
  const node = data as unknown as StepNodeData;
  return (
    <>
      <Handle type="target" position={Position.Left} id={TARGET_HANDLE} />
      <button
        className="wf-step wf-node"
        aria-pressed={node.active}
        onClick={() => node.onSelect(id)}
      >
        <span className="wf-step-number">{node.index}</span>
        <span>
          <strong>{node.title}</strong>
          {node.subtitle ? <small>{node.subtitle}</small> : null}
        </span>
      </button>
      {node.handles.map((handle, position) => (
        <Handle
          key={handle.id}
          type="source"
          position={Position.Right}
          id={handle.id}
          style={
            node.handles.length > 1
              ? {
                  top: `${((position + 1) / (node.handles.length + 1)) * 100}%`,
                }
              : undefined
          }
        />
      ))}
    </>
  );
}

function WorkflowTriggerNode({ data }: NodeProps) {
  const node = data as unknown as { title: string; subtitle: string };
  return (
    <div className="wf-step wf-node-trigger">
      <span className="wf-step-number">0</span>
      <span>
        <strong>{node.title}</strong>
        <small>{node.subtitle}</small>
      </span>
      <Handle type="source" position={Position.Right} id={START_HANDLE} />
    </div>
  );
}

const nodeTypes = {
  workflowStep: WorkflowStepNode,
  workflowTrigger: WorkflowTriggerNode,
} satisfies NodeTypes;

function loadPositions(
  storageId: string,
): Record<string, { x: number; y: number }> {
  try {
    const raw = localStorage.getItem(storageId);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, { x: number; y: number }] =>
          typeof entry[1] === "object" &&
          entry[1] !== null &&
          typeof (entry[1] as { x?: unknown }).x === "number" &&
          typeof (entry[1] as { y?: unknown }).y === "number",
      ),
    );
  } catch {
    return {};
  }
}

const triggerSummaries = {
  manual: "Acción manual",
  webhook: "Webhook recibido",
  created: "Registro creado",
  updated: "Registro actualizado",
  created_or_updated: "Registro creado o actualizado",
  deleted: "Registro eliminado",
  schedule: "Programación",
} as const;

export default function WorkflowCanvas({
  definition,
  selected,
  storageKey,
  onSelect,
  onConnectNode,
}: {
  definition: WorkflowDefinition;
  selected: string;
  storageKey: string;
  onSelect: (id: string) => void;
  onConnectNode: (
    source: string,
    target: string,
    sourceHandle: string | null | undefined,
  ) => void;
}) {
  const t = useMessages(automationMessages);
  const storageId = `savia.workflow-canvas.${storageKey}`;
  const [positions, setPositions] = useState(() => loadPositions(storageId));
  useEffect(() => {
    setPositions(loadPositions(storageId));
  }, [storageId]);
  const text = {
    start: t("Inicio"),
    yes: t("Sí"),
    no: t("No"),
    approved: t("Aprobado"),
    rejected: t("Rechazado"),
    defect: t("Defecto"),
    body: t("Cuerpo"),
    stepCase: (index: number) => t("Caso %{value0}", { value0: index }),
    branch: (index: number) => t("Rama %{value0}", { value0: index }),
  };
  const auto = useMemo(() => layoutWorkflow(definition), [definition]);
  const nodes = useMemo<Node[]>(() => {
    const trigger = definition.trigger;
    const triggerNode: Node = {
      id: TRIGGER_NODE_ID,
      type: "workflowTrigger",
      position: positions[TRIGGER_NODE_ID] ?? auto[TRIGGER_NODE_ID],
      selectable: false,
      draggable: false,
      data: {
        title: t("Inicio"),
        subtitle: t(
          triggerSummaries[
            trigger.type as keyof typeof triggerSummaries
          ] as keyof typeof automationMessages,
        ),
      },
    };
    return [
      triggerNode,
      ...definition.nodes.map((step, index) => ({
        id: step.id,
        type: "workflowStep",
        position: positions[step.id] ?? auto[step.id],
        data: {
          index: index + 1,
          title: step.label || t(stepLabels[step.type]),
          subtitle: t(stepLabels[step.type]),
          handles: sourceHandles(step),
          active: selected === step.id,
          onSelect,
        },
      })),
    ];
  }, [definition, positions, auto, selected, onSelect, t]);
  const edges = useMemo<Edge[]>(
    () =>
      buildWorkflowEdges(definition, text).map((edge) => ({
        ...edge,
        markerEnd: { type: MarkerType.ArrowClosed },
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [definition, text.start, text.yes, text.no, text.defect, text.body],
  );
  function moveNodes(changes: NodeChange[]) {
    if (
      !changes.some((change) => change.type === "position" && change.position)
    )
      return;
    setPositions((current) => {
      const next = { ...current };
      for (const change of changes)
        if (change.type === "position" && change.position)
          next[change.id] = change.position;
      try {
        localStorage.setItem(storageId, JSON.stringify(next));
      } catch {
        // Session layout is advisory; the definition is the source of truth.
      }
      return next;
    });
  }
  return (
    <div className="wf-flow" aria-label={t("Mapa del flujo")}>
      <ReactFlow
        key={nodes.map((node) => node.id).join(",")}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={moveNodes}
        onConnect={(connection) => {
          if (connection.source && connection.target)
            onConnectNode(
              connection.source,
              connection.target,
              connection.sourceHandle,
            );
        }}
        nodesConnectable
        edgesReconnectable={false}
        deleteKeyCode={null}
        fitView
        fitViewOptions={{ maxZoom: 1, padding: 0.15 }}
      >
        <Background />
        <MiniMap pannable zoomable />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
