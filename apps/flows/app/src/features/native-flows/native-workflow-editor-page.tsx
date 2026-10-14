import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeProps,
  type OnReconnect,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  ArrowLeft,
  GitBranch,
  History,
  Inbox,
  Play,
  Plus,
  Save,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { Link, useBlocker, useParams } from "react-router";
import { fieldEntries, type StudioObject } from "@savia/studio-shared/metadata";
import {
  workflowDraftSchema,
  type WorkflowDefinition,
  type WorkflowNode,
  type WorkflowValue,
} from "@savia/studio-shared/workflows";

import { useAuth } from "@/components/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  nativeWorkflowRequest,
  publishNativeWorkflow,
  type NativeRun,
  type NativeWorkflow,
} from "@/services/native-workflow-service";
import {
  NativeDefinition,
  canConnectNativeNodes,
  connectNativeNodes,
  disconnectNativeEdge,
  graphEdges,
  removeNativeNode,
  setNativePositions,
} from "./native-graph";
import {
  newStep,
  stepLabels,
  StepEditor,
  TriggerEditor,
  ValueInput,
} from "./workflow-editor";
import { WorkflowWebhookSettings } from "./workflow-webhooks";
import { NativeRunDetails } from "./native-run-details";
import { useNativeMessages } from "./use-native-messages";
import "./workflows.css";
import "./native-flows.css";

type GraphData = { step: WorkflowNode; selected: boolean };
type RunListItem = Pick<NativeRun, "id" | "status" | "created_at">;
type Bundle = {
  id: string;
  label: string;
  description: string;
  missing: string[];
  workflows: string[];
};

const titleFor = (node: WorkflowNode, translate: (key: string) => string) =>
  node.label || translate(stepLabels[node.type]);

function FlowNode({ data, selected }: NodeProps<Node<GraphData>>) {
  const t = useNativeMessages();
  const node = data.step;
  return (
    <div className={`native-flow-node ${selected ? "is-selected" : ""}`}>
      <Handle type="target" position={Position.Top} />
      <div className="native-flow-node-kind">
        {node.type === "condition" ? <GitBranch size={13} /> : null}
        {node.type}
      </div>
      <strong>{titleFor(node, t)}</strong>
      <small>{node.id}</small>
      {node.type === "condition" ? (
        <div className="native-flow-branch-labels">
          <span>True</span>
          <span>False</span>
        </div>
      ) : null}
      {node.type === "condition" ? (
        <>
          <Handle
            id="true"
            type="source"
            position={Position.Bottom}
            style={{ left: "30%" }}
          />
          <Handle
            id="false"
            type="source"
            position={Position.Bottom}
            style={{ left: "70%" }}
          />
        </>
      ) : (
        <Handle id="next" type="source" position={Position.Bottom} />
      )}
    </div>
  );
}

const nodeTypes = { nativeStep: FlowNode };
const requestError = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

export function NativeWorkflowEditorPage() {
  const { organizationId = "", id = "" } = useParams();
  const t = useNativeMessages();
  const { organization } = useAuth();
  const orgId = organizationId || organization?.id || "";
  const { mutate: globalMutate } = useSWRConfig();
  const workflowKey = `/savia/native/${orgId}/workflows/${id}`;
  const workflowQuery = useSWR(workflowKey, () =>
    nativeWorkflowRequest<{ data: NativeWorkflow }>(orgId, `/workflows/${id}`),
  );
  const objectsQuery = useSWR(
    orgId ? `/savia/native/${orgId}/objects` : null,
    () => nativeWorkflowRequest<{ data: StudioObject[] }>(orgId, "/objects"),
  );
  const listQuery = useSWR(
    orgId ? `/savia/native/${orgId}/workflows` : null,
    () =>
      nativeWorkflowRequest<{ data: NativeWorkflow[] }>(orgId, "/workflows"),
  );
  const historyKey = id
    ? `/savia/native/${orgId}/workflows/${id}/executions`
    : null;
  const historyQuery = useSWR(
    historyKey,
    () =>
      nativeWorkflowRequest<{ data: RunListItem[] }>(
        orgId,
        `/workflows/${id}/executions`,
      ),
    { refreshInterval: 5000 },
  );
  const inboxKey = `/savia/native/${orgId}/workflow-inbox`;
  const inboxQuery = useSWR(
    inboxKey,
    () =>
      nativeWorkflowRequest<{
        data: { id: string; title: string; kind: string; status: string }[];
      }>(orgId, "/workflow-inbox"),
    { refreshInterval: 10000 },
  );
  const bundlesQuery = useSWR(`/savia/native/${orgId}/workflow-bundles`, () =>
    nativeWorkflowRequest<{ data: Bundle[] }>(orgId, "/workflow-bundles"),
  );

  const [draft, setDraft] = useState<NativeWorkflow | null>(null);
  const [dirty, setDirty] = useState(false);
  const [selectedNode, setSelectedNode] = useState("");
  const [inspector, setInspector] = useState<"trigger" | "step">("step");
  const [mobileInspectorOpen, setMobileInspectorOpen] = useState(false);
  const [manualData, setManualData] = useState<Record<string, WorkflowValue>>(
    {},
  );
  const [selectedRun, setSelectedRun] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [newType, setNewType] = useState<WorkflowNode["type"]>("transform");
  const manualAttempt = useRef<{ fingerprint: string; key: string } | null>(
    null,
  );
  const blocker = useBlocker(useCallback(() => dirty, [dirty]));

  useEffect(() => {
    if (!dirty) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [dirty]);

  const saved = workflowQuery.data?.data;
  const current = draft ?? saved ?? null;
  const objects = objectsQuery.data?.data ?? [];
  const nativeObjects = objects.filter(
    (o) =>
      !o.config.studio?.collection?.kind ||
      o.config.studio.collection.kind === "crm",
  );
  const selected =
    current?.definition.nodes.find((node) => node.id === selectedNode) ??
    current?.definition.nodes[0];
  const removableDefinition =
    current && selected
      ? removeNativeNode(current.definition, selected.id)
      : null;
  const deletionBlocked =
    !!current &&
    !!selected &&
    current.definition.nodes.length > 1 &&
    !removableDefinition &&
    current.definition.nodes[0].id === selected.id &&
    selected.type === "condition" &&
    !!selected.next &&
    !!selected.otherwise &&
    selected.next !== selected.otherwise;

  const update = (next: NativeWorkflow) => {
    setDraft(next);
    setDirty(true);
    setNotice("");
  };
  const definition = current?.definition;
  const graphNodes = useMemo<Node<GraphData>[]>(() => {
    if (!definition) return [];
    const positions = (definition as NativeDefinition).positions ?? {};
    return definition.nodes.map((step, index) => ({
      id: step.id,
      type: "nativeStep",
      position: positions[step.id] ?? {
        x: index % 2 ? 330 : 90,
        y: index * 180,
      },
      data: { step, selected: step.id === selectedNode },
      selected: step.id === selectedNode,
    }));
  }, [definition, selectedNode]);
  const graphEdgeList = useMemo(
    () => (definition ? graphEdges(definition) : []),
    [definition],
  );

  const updateDefinition = (next: WorkflowDefinition) => {
    if (current) update({ ...current, definition: next as NativeDefinition });
  };
  const onNodesChange = useCallback(
    (changes: NodeChange<Node<GraphData>>[]) => {
      if (!definition || !current) return;
      const updated = applyNodeChanges(changes, graphNodes);
      const positions = Object.fromEntries(
        updated.map((node) => [node.id, node.position]),
      );
      const selectedChange = changes.find(
        (change) => change.type === "select" && change.selected,
      );
      if (selectedChange?.type === "select") {
        setSelectedNode(selectedChange.id);
        setInspector("step");
        setMobileInspectorOpen(true);
      }
      const moved = changes.some(
        (change) => change.type === "position" && change.dragging === false,
      );
      if (moved)
        update({
          ...current,
          definition: setNativePositions(
            current.definition as NativeDefinition,
            positions,
          ),
        });
    },
    [current, definition, graphNodes],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange<Edge>[]) => {
      if (!definition) return;
      const removed = changes.filter((change) => change.type === "remove");
      if (!removed.length) return;
      let next = definition;
      for (const change of removed) {
        const edge = graphEdgeList.find((item) => item.id === change.id);
        if (!edge) continue;
        next = {
          ...next,
          nodes: next.nodes.map((node) => {
            if (node.id !== edge.source) return node;
            if (node.type === "condition" && edge.sourceHandle === "false")
              return { ...node, otherwise: undefined };
            return { ...node, next: undefined } as WorkflowNode;
          }),
        };
      }
      updateDefinition(next);
    },
    [definition, graphEdgeList],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!definition) return;
      if (!canConnectNativeNodes(definition, connection)) {
        setError(
          "That connection would create a cycle or uses an invalid branch.",
        );
        return;
      }
      setError("");
      updateDefinition(connectNativeNodes(definition, connection));
    },
    [definition],
  );

  const onReconnect: OnReconnect = useCallback(
    (_oldEdge, connection) => {
      if (!definition) return;
      const disconnected = disconnectNativeEdge(
        definition,
        _oldEdge.source,
        _oldEdge.sourceHandle ?? null,
      );
      if (canConnectNativeNodes(disconnected, connection))
        updateDefinition(connectNativeNodes(disconnected, connection));
      else
        setError(
          "That connection would create a cycle or uses an invalid branch.",
        );
    },
    [definition],
  );

  const save = async () => {
    if (!current) return;
    setBusy(true);
    setError("");
    try {
      const { positions, ...persistedDefinition } =
        current.definition as NativeDefinition;
      const parsed = workflowDraftSchema.safeParse({
        name: current.name,
        definition: persistedDefinition,
      });
      if (!parsed.success)
        throw new Error(
          parsed.error.issues.map((issue) => issue.message).join(". "),
        );
      const result = await nativeWorkflowRequest<{ data: NativeWorkflow }>(
        orgId,
        current.id ? `/workflows/${current.id}` : "/workflows",
        current.id ? "PUT" : "POST",
        {
          ...parsed.data,
          definition: {
            ...parsed.data.definition,
            ...(positions ? { positions } : {}),
          },
          ...(current.id ? { revision: current.revision } : {}),
        },
      );
      setDraft(result.data);
      setDirty(false);
      setNotice("Draft saved. Publish when the workflow is ready.");
      await Promise.all([
        workflowQuery.mutate({ data: result.data }, false),
        listQuery.mutate(),
      ]);
    } catch (cause) {
      setError(requestError(cause));
    } finally {
      setBusy(false);
    }
  };

  const action = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      await Promise.all([
        workflowQuery.mutate(),
        listQuery.mutate(),
        historyQuery.mutate(),
        inboxQuery.mutate(),
      ]);
    } catch (cause) {
      setError(requestError(cause));
    } finally {
      setBusy(false);
    }
  };

  const addNode = () => {
    if (!current || current.definition.nodes.length >= 50) return;
    let n = current.definition.nodes.length + 1;
    while (current.definition.nodes.some((node) => node.id === `step_${n}`))
      n++;
    const added = newStep(newType, `step_${n}`, nativeObjects[0]?.name ?? "");
    update({
      ...current,
      definition: {
        ...current.definition,
        nodes: [...current.definition.nodes, added],
      } as NativeDefinition,
    });
    setSelectedNode(added.id);
    setInspector("step");
  };

  const removeNode = () => {
    if (!current || !selected) return;
    const next = removeNativeNode(current.definition, selected.id);
    if (!next) {
      setError(
        "This step cannot be removed safely. Reconnect its incoming branch first.",
      );
      return;
    }
    update({
      ...current,
      definition: next as NativeDefinition,
    });
    setSelectedNode(next.nodes[0].id);
  };

  const selectedExecution = useSWR(
    selectedRun
      ? `/savia/native/${orgId}/workflow-executions/${selectedRun}`
      : null,
    () =>
      nativeWorkflowRequest<{ data: NativeRun }>(
        orgId,
        `/workflow-executions/${selectedRun}`,
      ),
    { refreshInterval: 5000 },
  );

  if (workflowQuery.isLoading || objectsQuery.isLoading)
    return (
      <main className="native-page">
        <p role="status">Loading Savia workflow…</p>
      </main>
    );
  if (workflowQuery.error || objectsQuery.error)
    return (
      <main className="native-page">
        <p role="alert">
          {requestError(workflowQuery.error ?? objectsQuery.error)}
        </p>
        <Link to={`/org/${orgId}/workflows`}>Back to workflows</Link>
      </main>
    );
  if (!current)
    return (
      <main className="native-page">
        <p role="alert">Workflow not found.</p>
      </main>
    );

  const trigger = current.definition.trigger;
  const manualObject =
    trigger.type === "manual"
      ? nativeObjects.find((item) => item.name === trigger.collection)
      : undefined;

  return (
    <main className="native-page">
      <header className="native-editor-header">
        <div className="native-editor-heading">
          <Link to={`/org/${orgId}/workflows`} aria-label="Back to workflows">
            <ArrowLeft size={18} />
          </Link>
          <div>
            <p className="native-eyebrow">Savia workflow</p>
            <Input
              aria-label="Workflow name"
              value={current.name}
              onChange={(event) =>
                update({ ...current, name: event.target.value })
              }
            />
          </div>
        </div>
        <div className="native-editor-actions">
          <span
            className={
              current.enabled
                ? "wf-badge wf-badge-ok"
                : "wf-badge wf-badge-muted"
            }
          >
            {current.enabled ? "Active" : "Inactive"}
          </span>
          <Button disabled={busy || !dirty} onClick={() => void save()}>
            <Save size={15} /> Save draft
          </Button>
          <Button
            variant="outline"
            disabled={busy || dirty || !current.id}
            onClick={() =>
              void action(async () => {
                const response = await publishNativeWorkflow(
                  orgId,
                  current.id,
                  current.revision,
                );
                setDraft(response.data);
                setNotice("An immutable version was published.");
              })
            }
          >
            Publish
          </Button>
          {current.published_version ? (
            <Button
              variant="outline"
              disabled={busy || dirty}
              onClick={() =>
                void action(async () => {
                  const response = await nativeWorkflowRequest<{
                    data: NativeWorkflow;
                  }>(orgId, `/workflows/${current.id}/enabled`, "POST", {
                    enabled: !current.enabled,
                  });
                  setDraft(response.data);
                })
              }
            >
              {current.enabled ? "Deactivate" : "Activate"}
            </Button>
          ) : null}
        </div>
      </header>
      {blocker.state === "blocked" ? (
        <section
          className="native-navigation-warning"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="native-unsaved-title"
          aria-describedby="native-unsaved-description"
        >
          <div>
            <strong id="native-unsaved-title">Unsaved workflow changes</strong>
            <p id="native-unsaved-description">
              Leave this page and discard the current draft changes?
            </p>
          </div>
          <div>
            <Button variant="outline" onClick={() => blocker.reset()}>
              Stay on this page
            </Button>
            <Button variant="destructive" onClick={() => blocker.proceed()}>
              Leave and discard
            </Button>
          </div>
        </section>
      ) : null}
      {notice ? (
        <p className="native-notice" role="status">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="native-inline-error" role="alert">
          {error}
        </p>
      ) : null}
      <section className="native-editor-toolbar" aria-label="Graph controls">
        <label>
          Step type
          <select
            value={newType}
            onChange={(event) =>
              setNewType(event.target.value as WorkflowNode["type"])
            }
          >
            {(Object.keys(stepLabels) as WorkflowNode["type"][]).map((type) => (
              <option key={type} value={type}>
                {t(stepLabels[type])}
              </option>
            ))}
          </select>
        </label>
        <Button
          variant="outline"
          onClick={addNode}
          disabled={current.definition.nodes.length >= 50}
        >
          <Plus size={15} /> Add step
        </Button>
        <div className="native-editor-tabs">
          <Button
            variant={inspector === "trigger" ? "secondary" : "ghost"}
            onClick={() => {
              setInspector("trigger");
              setMobileInspectorOpen(true);
            }}
          >
            Trigger
          </Button>
          <Button
            variant={inspector === "step" ? "secondary" : "ghost"}
            onClick={() => {
              setInspector("step");
              setMobileInspectorOpen(true);
            }}
          >
            Selected step
          </Button>
        </div>
      </section>
      <div className="native-editor-grid">
        <section className="native-graph-shell" aria-label="Workflow graph">
          <div className="native-node-list" aria-label="Select a workflow step">
            {current.definition.nodes.map((node) => (
              <button
                key={node.id}
                aria-pressed={selected?.id === node.id}
                onClick={() => {
                  setSelectedNode(node.id);
                  setInspector("step");
                  setMobileInspectorOpen(true);
                }}
              >
                {titleFor(node, t)} <small>{node.id}</small>
              </button>
            ))}
          </div>
          <div className="native-graph">
            <ReactFlow
              nodes={graphNodes}
              edges={graphEdgeList}
              nodeTypes={nodeTypes}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onReconnect={onReconnect}
              onNodeClick={(_, node) => {
                setSelectedNode(node.id);
                setInspector("step");
                setMobileInspectorOpen(true);
              }}
              edgesReconnectable
              deleteKeyCode={["Backspace", "Delete"]}
              fitView
              fitViewOptions={{ padding: 0.3 }}
              aria-label="Savia workflow nodes"
            >
              <Background gap={20} />
              <Controls />
            </ReactFlow>
          </div>
        </section>
        <aside
          className={`native-inspector${mobileInspectorOpen ? " is-open" : ""}`}
          aria-label="Workflow settings"
        >
          <div className="native-inspector-head">
            <h2>
              {inspector === "trigger" ? "Start conditions" : "Step settings"}
            </h2>
            <div>
              {inspector === "step" &&
              selected &&
              current.definition.nodes.length > 1 ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={removeNode}
                  disabled={!removableDefinition}
                  aria-label="Remove selected step"
                  aria-describedby={
                    deletionBlocked ? "native-delete-help" : undefined
                  }
                >
                  <Trash2 size={15} /> Remove
                </Button>
              ) : null}
              <Button
                className="native-inspector-close"
                variant="ghost"
                size="sm"
                onClick={() => setMobileInspectorOpen(false)}
                aria-label="Close settings"
              >
                <X size={16} />
              </Button>
            </div>
          </div>
          {deletionBlocked ? (
            <p
              id="native-delete-help"
              className="native-inline-error"
              role="status"
            >
              Reconnect or remove one output branch before deleting the entry
              condition.
            </p>
          ) : null}
          {inspector === "trigger" ? (
            <TriggerEditor
              definition={current.definition}
              objects={nativeObjects}
              onChange={updateDefinition}
            />
          ) : selected ? (
            <StepEditor
              node={selected}
              definition={current.definition}
              objects={nativeObjects}
              organizationId={orgId}
              onChange={(node) =>
                updateDefinition({
                  ...current.definition,
                  nodes: current.definition.nodes.map((item) =>
                    item.id === node.id ? node : item,
                  ),
                })
              }
            />
          ) : null}
        </aside>
      </div>
      {trigger.type === "webhook" ? (
        current.id ? (
          <WorkflowWebhookSettings
            organizationId={orgId}
            workflowId={current.id}
          />
        ) : (
          <p className="wf-muted">Save the draft to create its webhook URL.</p>
        )
      ) : null}
      {trigger.type === "manual" ? (
        <section className="wf-manual native-panel">
          <h2>Manual run</h2>
          <p className="wf-muted">
            Run the currently published version with these input values.
          </p>
          {manualObject
            ? fieldEntries(manualObject).map(([key, field]) => (
                <ValueInput
                  key={key}
                  label={field.label}
                  value={manualData[key] ?? ""}
                  variables={[]}
                  onChange={(value) =>
                    setManualData({ ...manualData, [key]: value })
                  }
                />
              ))
            : null}
          <Button
            disabled={busy || dirty || !current.enabled || !current.id}
            onClick={() =>
              void action(async () => {
                const fingerprint = JSON.stringify([
                  current.id,
                  current.published_version,
                  manualData,
                ]);
                if (manualAttempt.current?.fingerprint !== fingerprint)
                  manualAttempt.current = {
                    fingerprint,
                    key: crypto.randomUUID(),
                  };
                const response = await nativeWorkflowRequest<{
                  data: NativeRun;
                }>(orgId, `/workflows/${current.id}/start`, "POST", {
                  data: manualData,
                  key: manualAttempt.current.key,
                });
                manualAttempt.current = null;
                setSelectedRun(response.data.id);
              })
            }
          >
            <Play size={15} /> Run published version
          </Button>
        </section>
      ) : null}
      <section className="native-panel native-support-grid">
        <div>
          <h2>
            <History size={16} /> Run history
          </h2>
          {historyQuery.data?.data.map((run) => (
            <button
              className="native-support-row"
              key={run.id}
              aria-pressed={selectedRun === run.id}
              onClick={() => setSelectedRun(run.id)}
            >
              <span
                className={`wf-badge ${run.status === "completed" ? "wf-badge-ok" : run.status === "failed" || run.status === "blocked" ? "wf-badge-error" : "wf-badge-muted"}`}
              >
                {run.status}
              </span>
              <small>{run.created_at}</small>
            </button>
          ))}
          {historyQuery.data?.data.length === 0 ? (
            <p className="wf-muted">No runs yet.</p>
          ) : null}
          {selectedExecution.data?.data ? (
            <NativeRunDetails
              run={selectedExecution.data.data}
              busy={busy}
              onCancel={() =>
                void action(async () => {
                  await nativeWorkflowRequest(
                    orgId,
                    `/workflow-executions/${selectedRun}/cancel`,
                    "POST",
                  );
                })
              }
              onRetry={() =>
                void action(async () => {
                  await nativeWorkflowRequest(
                    orgId,
                    `/workflow-executions/${selectedRun}/retry`,
                    "POST",
                  );
                })
              }
            />
          ) : null}
        </div>
        <div>
          <h2>
            <Inbox size={16} /> Task inbox
          </h2>
          {inboxQuery.data?.data
            .filter((task) => task.status !== "done")
            .map((task) => (
              <div className="native-support-row" key={task.id}>
                <span>
                  <strong>{task.title}</strong>
                  <small>{task.kind}</small>
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    void action(async () => {
                      await nativeWorkflowRequest(
                        orgId,
                        `/workflow-inbox/${task.id}/resolve`,
                        "POST",
                      );
                    })
                  }
                >
                  Resolve
                </Button>
              </div>
            ))}
          {inboxQuery.data?.data.filter((task) => task.status !== "done")
            .length === 0 ? (
            <p className="wf-muted">No tasks waiting for you.</p>
          ) : null}
        </div>
      </section>
      <section className="native-panel native-bundles">
        <h2>Workflow bundles</h2>
        <p className="wf-muted">
          Prepare related collections and draft workflows from a bundle.
        </p>
        {bundlesQuery.data?.data.map((bundle) => (
          <article key={bundle.id}>
            <div>
              <strong>{bundle.label}</strong>
              <p className="wf-muted">{bundle.description}</p>
            </div>
            <Button
              variant="outline"
              disabled={busy || !!bundle.missing.length}
              onClick={() =>
                void action(async () => {
                  await nativeWorkflowRequest(
                    orgId,
                    `/workflow-bundles/${bundle.id}/prepare`,
                    "POST",
                  );
                  await globalMutate(
                    (key) =>
                      typeof key === "string" && key.includes("/objects"),
                  );
                })
              }
            >
              {bundle.missing.length
                ? `Missing: ${bundle.missing.join(", ")}`
                : "Prepare"}
            </Button>
          </article>
        ))}
      </section>
    </main>
  );
}
