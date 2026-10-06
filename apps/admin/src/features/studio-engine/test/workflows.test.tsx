import React from "react";
import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
} from "@testing-library/react";
import { render } from "./locale-test-render";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Workflows from "../workflows";
import { api } from "../api";
import { setStudioRuntime } from "../runtime";
import { StepEditor, TriggerEditor } from "../workflow-editor";
import {
  buildWorkflowEdges,
  connectStepTarget,
  layoutWorkflow,
} from "../workflow-canvas";
import { TriggerConditions } from "../workflow-trigger-conditions";
import { makeConfig } from "@savia/studio-shared/metadata";
import {
  workflowDefinitionSchema,
  type WorkflowDefinition,
  type WorkflowNode,
  type WorkflowTriggerCondition,
} from "@savia/studio-shared/workflows";
vi.mock("../api", () => ({ api: vi.fn() }));
vi.mock("@xyflow/react", () => ({
  ReactFlow: ({ nodes, edges, nodeTypes, onConnect }: any) => (
    <div>
      {nodes.map((node: any) => {
        const Node = nodeTypes[node.type];
        return (
          <div key={node.id}>
            <button onClick={() => node.data.onSelect?.(node.id)}>
              Seleccionar {node.data.title ?? node.id}
            </button>
            {Node ? (
              <Node id={node.id} data={node.data} selected={false} />
            ) : null}
          </div>
        );
      })}
      {edges.map((edge: any) => (
        <span key={edge.id} data-testid={`edge-${edge.id}`}>
          {edge.label}
        </span>
      ))}
      <button
        onClick={() =>
          nodes.length > 2 &&
          onConnect({
            source: nodes[nodes.length - 1].id,
            sourceHandle: "next",
            target: nodes[1].id,
          })
        }
      >
        Conectar canvas
      </button>
    </div>
  ),
  Handle: ({ id }: any) => <span data-testid={`handle-${id}`} />,
  Background: () => null,
  Controls: () => null,
  MiniMap: () => null,
  MarkerType: { ArrowClosed: "arrow" },
  Position: { Right: "right", Left: "left" },
}));
it("preserves partial numeric input and only accepts complete numeric filters", () => {
  let saved: WorkflowTriggerCondition[];
  function Editor() {
    const [conditions, setConditions] = React.useState<
      WorkflowTriggerCondition[]
    >([{ field: "amount", operator: "gte", value: 0 }]);
    saved = conditions;
    return (
      <TriggerConditions
        conditions={conditions}
        mode="all"
        fields={[{ name: "amount", label: "Amount" }]}
        onChange={setConditions}
        onModeChange={() => {}}
      />
    );
  }
  render(<Editor />);
  const input = screen.getByLabelText("Valor de condición 1");
  fireEvent.change(input, { target: { value: "-" } });
  expect(input).toHaveValue("-");
  expect(
    workflowDefinitionSchema.safeParse({
      trigger: { type: "created", collection: "requests", conditions: saved! },
      nodes: [{ id: "done", type: "transform", values: {} }],
    }).success,
  ).toBe(false);
  for (const value of ["-1", "-1.", "-1.5"]) {
    fireEvent.change(input, { target: { value } });
    expect(input).toHaveValue(value);
  }
  expect(saved![0].value).toBe(-1.5);
});
it("edits collection filters and clears fields when switching collections", () => {
  let saved: WorkflowDefinition;
  function Editor() {
    const [definition, setDefinition] = React.useState<WorkflowDefinition>({
      trigger: { type: "created", collection: "requests" },
      nodes: [{ id: "done", type: "transform", values: {} }],
    });
    saved = definition;
    return (
      <TriggerEditor
        definition={definition}
        onChange={setDefinition}
        objects={
          [
            {
              name: "requests",
              label: "Requests",
              config: makeConfig({
                status: { type: "Textbox", label: "Status" },
              }),
            },
            {
              name: "others",
              label: "Others",
              config: makeConfig({ name: { type: "Textbox", label: "Name" } }),
            },
          ] as any
        }
      />
    );
  }
  render(<Editor />);
  fireEvent.change(screen.getByLabelText("Disparador"), {
    target: { value: "created_or_updated" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Añadir condición" }));
  fireEvent.change(screen.getByLabelText("Valor de condición 1"), {
    target: { value: "approved" },
  });
  expect(saved!.trigger).toMatchObject({
    type: "created_or_updated",
    conditions: [{ field: "status", operator: "eq", value: "approved" }],
  });
  fireEvent.change(screen.getByLabelText("Colección"), {
    target: { value: "others" },
  });
  expect(saved!.trigger).toMatchObject({
    collection: "others",
    changedFields: [],
    conditions: [],
  });
  fireEvent.change(screen.getByLabelText("Disparador"), {
    target: { value: "deleted" },
  });
  expect(
    screen.queryByLabelText("Campos que deben cambiar"),
  ).not.toBeInTheDocument();
  expect(screen.getByText(/registro eliminado/)).toBeInTheDocument();
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  setStudioRuntime({ embedded: false });
});
function setup() {
  vi.mocked(api).mockImplementation(async (url, method, data: any) => ({
    data:
      method === "POST" ? { id: "flow", revision: 1, enabled: 0, ...data } : [],
  }));
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <Workflows objects={[]} />
    </QueryClientProvider>,
  );
}
it("creates a general draft, saves it on the backend, and keeps publication explicit", async () => {
  setup();
  fireEvent.click(await screen.findByRole("button", { name: "Nuevo flujo" }));
  fireEvent.change(screen.getByLabelText("Nombre del flujo"), {
    target: { value: "Request review" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Guardar borrador" }));
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(
      "/workflows",
      "POST",
      expect.objectContaining({
        name: "Request review",
        definition: expect.objectContaining({ trigger: { type: "manual" } }),
      }),
    ),
  );
  expect(
    vi.mocked(api).mock.calls.some(([url]) => url.includes("publish")),
  ).toBe(false);
});
it("shows invalid configuration without sending it to the API", async () => {
  setup();
  fireEvent.click(await screen.findByRole("button", { name: "Nuevo flujo" }));
  fireEvent.change(screen.getByLabelText("Nombre del flujo"), {
    target: { value: "" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Guardar borrador" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Revisa");
  expect(
    vi.mocked(api).mock.calls.some(([, method]) => method === "POST"),
  ).toBe(false);
});
it("saves selected variables as typed references rather than interpolated strings", async () => {
  setup();
  fireEvent.click(await screen.findByRole("button", { name: "Nuevo flujo" }));
  fireEvent.click(screen.getByRole("button", { name: "Añadir valor" }));
  fireEvent.change(screen.getByLabelText("Tipo de Valor 1"), {
    target: { value: "ref" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Guardar borrador" }));
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(
      "/workflows",
      "POST",
      expect.objectContaining({
        definition: expect.objectContaining({
          nodes: [
            {
              id: "step_1",
              type: "transform",
              values: { value_1: { ref: "system.owner" } },
            },
          ],
        }),
      }),
    ),
  );
});
it("clears an unsaved draft when the tenant changes", async () => {
  vi.mocked(api).mockResolvedValue({ data: [] });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const element = () => (
    <QueryClientProvider client={client}>
      <Workflows objects={[]} />
    </QueryClientProvider>
  );
  setStudioRuntime({ embedded: true, tenantId: 1 });
  const view = render(element());
  fireEvent.click(await screen.findByRole("button", { name: "Nuevo flujo" }));
  fireEvent.change(screen.getByLabelText("Nombre del flujo"), {
    target: { value: "Private tenant draft" },
  });
  setStudioRuntime({ embedded: true, tenantId: 2 });
  view.rerender(element());
  expect(
    screen.queryByDisplayValue("Private first-domain draft"),
  ).not.toBeInTheDocument();
});
it("preserves a workflow draft and offers an explicit reload after a remote revision", async () => {
  const original = {
    id: "flow-1",
    name: "Shared flow",
    revision: 1,
    enabled: 0,
    definition: {
      trigger: { type: "manual" as const },
      nodes: [{ id: "step_1", type: "transform" as const, values: {} }],
    },
  };
  let serverFlow = original;
  vi.mocked(api).mockImplementation(async (url) => ({
    data:
      url === "/workflows"
        ? [serverFlow]
        : url === "/workflow-bundles"
          ? []
          : [],
  }));
  setStudioRuntime({ embedded: true, tenantId: 7, apiBasePath: "/tenant/7" });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchInterval: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <Workflows objects={[]} />
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole("button", { name: /Shared flow/ }));
  const name = screen.getByLabelText("Nombre del flujo");
  fireEvent.change(name, { target: { value: "My local draft" } });

  serverFlow = { ...original, name: "Remote flow", revision: 2 };
  const workflowsQuery = client.getQueryCache().findAll({
    queryKey: ["workflows"],
  })[0];
  await act(() => {
    client.setQueryData(workflowsQuery.queryKey, { data: [serverFlow] });
  });

  expect(name).toHaveValue("My local draft");
  expect(await screen.findByText("Remote flow")).toBeInTheDocument();
  expect(
    await screen.findByText(/Tus ediciones se conservan/),
  ).toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: "Recargar y descartar borrador" }),
  );
  expect(await screen.findByLabelText("Nombre del flujo")).toHaveValue(
    "Remote flow",
  );
});
it("reuses the manual delivery key after an uncertain network failure", async () => {
  const flow = {
    id: "saved",
    name: "Manual test",
    revision: 1,
    enabled: 1,
    published_version: "saved:1",
    definition: {
      trigger: { type: "manual" },
      nodes: [{ id: "done", type: "transform", values: {} }],
    },
  };
  vi.mocked(api).mockImplementation(async (url) => {
    if (url.endsWith("/start")) throw new Error("Network interrupted");
    return { data: url === "/workflows" ? [flow] : [] };
  });
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <Workflows objects={[]} />
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole("button", { name: /Manual test/ }));
  fireEvent.click(
    screen.getByRole("button", { name: "Ejecutar versión publicada" }),
  );
  await screen.findByText("Network interrupted");
  fireEvent.click(
    screen.getByRole("button", { name: "Ejecutar versión publicada" }),
  );
  await waitFor(() =>
    expect(
      vi.mocked(api).mock.calls.filter(([url]) => url.endsWith("/start")),
    ).toHaveLength(2),
  );
  const starts = vi
    .mocked(api)
    .mock.calls.filter(([url]) => url.endsWith("/start"));
  expect((starts[0][2] as any).key).toBe((starts[1][2] as any).key);
});

it("prepares a contributed bundle without publishing or replacing a draft", async () => {
  vi.mocked(api).mockImplementation(async (url, method) => ({
    data:
      url === "/workflow-bundles"
        ? [
            {
              id: "example.links",
              label: "Related requests",
              description: "Add real links",
              missing: [],
              workflows: ["Create case"],
            },
          ]
        : method === "POST"
          ? { workflows: [] }
          : [],
  }));
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <Workflows objects={[]} />
    </QueryClientProvider>,
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "Preparar Related requests" }),
  );
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(
      "/workflow-bundles/example.links/prepare",
      "POST",
    ),
  );
  expect(await screen.findByRole("status")).toHaveTextContent(
    "Relaciones preparadas",
  );
  expect(
    vi.mocked(api).mock.calls.some(([url]) => url.endsWith("/publish")),
  ).toBe(false);
});

it("offers incoming webhooks without requiring a collection", async () => {
  setup();
  fireEvent.click(await screen.findByRole("button", { name: "Nuevo flujo" }));
  fireEvent.change(screen.getByLabelText("Disparador"), {
    target: { value: "webhook" },
  });
  expect(
    screen.getByText("Guarda el borrador para crear la URL del webhook."),
  ).toBeInTheDocument();
  expect(screen.queryByLabelText("Colección")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Guardar borrador" }));
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(
      "/workflows",
      "POST",
      expect.objectContaining({
        definition: expect.objectContaining({ trigger: { type: "webhook" } }),
      }),
    ),
  );
});
import {
  WorkflowWebhookSettings,
  WorkflowDestinationPicker,
} from "../workflow-webhooks";
it("reveals an incoming secret transiently and never puts it in the query cache", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  vi.mocked(api).mockImplementation(async (_url, method) => ({
    data: method === "POST" ? { id: "endpoint", secret: "reveal-once" } : null,
  }));
  render(
    <QueryClientProvider client={client}>
      <WorkflowWebhookSettings workflowId="test" />
    </QueryClientProvider>,
  );
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Crear URL y secreto" }),
    ).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Crear URL y secreto" }));
  expect(await screen.findByDisplayValue("reveal-once")).toBeInTheDocument();
  expect(
    JSON.stringify(
      client
        .getQueryCache()
        .getAll()
        .map((q) => q.state.data),
    ),
  ).not.toContain("reveal-once");
  fireEvent.click(screen.getByRole("button", { name: "Ocultar secreto" }));
  expect(screen.queryByDisplayValue("reveal-once")).not.toBeInTheDocument();
});
it("selects an immutable destination revision for an outgoing step", async () => {
  const onChange = vi.fn();
  vi.mocked(api).mockResolvedValue({
    data: [
      {
        id: "receiver",
        name: "Receiver",
        revision: 3,
        enabled: true,
        url: "https://hooks.hefesoft.com",
        authType: "none",
        hasSecret: false,
      },
    ],
  });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <WorkflowDestinationPicker
        value={{ destinationId: "", destinationRevision: 1 }}
        onChange={onChange}
      />
    </QueryClientProvider>,
  );
  await screen.findByRole("option", { name: "Receiver" });
  fireEvent.change(screen.getByLabelText("Destino HTTPS"), {
    target: { value: "receiver" },
  });
  expect(onChange).toHaveBeenCalledWith({
    destinationId: "receiver",
    destinationRevision: 3,
  });
});
it("edits the per-step error policy and attempt budget", () => {
  let saved: WorkflowNode | undefined;
  const definition: WorkflowDefinition = {
    trigger: { type: "manual" },
    nodes: [
      { id: "risky", type: "transform", values: {}, next: "done" },
      { id: "done", type: "transform", values: {} },
    ],
  };
  function Editor() {
    const [node, setNode] = React.useState<WorkflowNode>(definition.nodes[0]);
    saved = node;
    return (
      <StepEditor
        node={node}
        definition={definition}
        objects={[]}
        onChange={setNode}
      />
    );
  }
  render(<Editor />);
  fireEvent.change(screen.getByLabelText("Política de error"), {
    target: { value: "continue" },
  });
  expect(saved).toMatchObject({ onError: "continue" });
  fireEvent.change(screen.getByLabelText("Intentos máximos"), {
    target: { value: "1" },
  });
  expect(saved).toMatchObject({ maxAttempts: 1 });
  expect(
    workflowDefinitionSchema.safeParse({
      trigger: definition.trigger,
      nodes: [saved, definition.nodes[1]],
    }).success,
  ).toBe(true);
});
it("edits the source list of a loop step", () => {
  let saved: WorkflowNode | undefined;
  const definition: WorkflowDefinition = {
    trigger: { type: "manual" },
    nodes: [
      {
        id: "each",
        type: "map",
        items: { ref: "trigger.tags" },
        values: {},
      },
    ],
  };
  function Editor() {
    const [node, setNode] = React.useState<WorkflowNode>(definition.nodes[0]);
    saved = node;
    return (
      <StepEditor
        node={node}
        definition={definition}
        objects={[]}
        onChange={setNode}
      />
    );
  }
  render(<Editor />);
  fireEvent.change(screen.getByLabelText("Lista de origen"), {
    target: { value: "steps.find.records" },
  });
  expect(saved).toMatchObject({ items: { ref: "steps.find.records" } });
});
it("derives canvas edges with one handle per destination", () => {
  const text = {
    start: "Start",
    yes: "Yes",
    no: "No",
    defect: "Default",
    body: "Body",
    stepCase: (index: number) => `Case ${index}`,
  };
  const definition = {
    trigger: { type: "manual" },
    nodes: [
      {
        id: "check",
        type: "condition",
        left: "",
        operator: "eq",
        right: "",
        next: "fast",
        otherwise: "missing",
      },
      {
        id: "route",
        type: "switch",
        input: "",
        cases: [{ operator: "eq", value: "", next: "fast" }],
        otherwise: "fast",
      },
      {
        id: "repeat",
        type: "loop",
        items: { ref: "trigger.tags" },
        body: "fast",
        next: "fast",
      },
      { id: "fast", type: "transform", values: {} },
    ],
  } as any;
  const edges = buildWorkflowEdges(definition, text);
  expect(edges).toContainEqual(
    expect.objectContaining({
      source: "check",
      target: "fast",
      sourceHandle: "next",
      label: "Yes",
    }),
  );
  expect(edges).not.toContainEqual(
    expect.objectContaining({ source: "check", target: "missing" }),
  );
  expect(edges).toContainEqual(
    expect.objectContaining({
      source: "route",
      sourceHandle: "case:0",
      label: "Case 1",
    }),
  );
  expect(edges).toContainEqual(
    expect.objectContaining({
      source: "repeat",
      target: "fast",
      sourceHandle: "body",
      label: "Body",
    }),
  );
  expect(
    edges.filter(
      (edge) => edge.source === "__trigger__" && edge.target === "check",
    ),
  ).toHaveLength(1);
});

it("layers canvas nodes from the trigger without hanging on cycles", () => {
  const linear = {
    trigger: { type: "manual" },
    nodes: [
      { id: "a", type: "transform", values: {}, next: "b" },
      { id: "b", type: "transform", values: {} },
    ],
  } as any;
  const positions = layoutWorkflow(linear);
  expect(positions.__trigger__.x).toBe(0);
  expect(positions.a.x).toBeLessThan(positions.b.x);
  const cyclic = {
    trigger: { type: "manual" },
    nodes: [
      { id: "a", type: "transform", values: {}, next: "b" },
      { id: "b", type: "transform", values: {}, next: "a" },
    ],
  } as any;
  expect(() => layoutWorkflow(cyclic)).not.toThrow();
});

it("maps canvas connections onto step destinations", () => {
  expect(
    connectStepTarget(
      { id: "c", type: "condition", left: "", operator: "eq", right: "" },
      "otherwise",
      "end",
    ),
  ).toMatchObject({ otherwise: "end" });
  expect(
    connectStepTarget(
      {
        id: "s",
        type: "switch",
        input: "",
        cases: [{ operator: "eq", value: "" }],
      },
      "case:0",
      "end",
    ),
  ).toMatchObject({ cases: [{ operator: "eq", value: "", next: "end" }] });
  expect(
    connectStepTarget(
      {
        id: "s",
        type: "switch",
        input: "",
        cases: [{ operator: "eq", value: "" }],
      },
      "case:9",
      "end",
    ),
  ).toBeNull();
  expect(
    connectStepTarget(
      { id: "l", type: "loop", items: { ref: "trigger.tags" }, body: "a" },
      "body",
      "b",
    ),
  ).toMatchObject({ body: "b" });
  expect(
    connectStepTarget(
      { id: "t", type: "transform", values: {} },
      "next",
      "end",
    ),
  ).toMatchObject({ next: "end" });
});

it("selects a canvas step for configuration", async () => {
  setup();
  fireEvent.click(await screen.findByRole("button", { name: "Nuevo flujo" }));
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Seleccionar Transformar datos",
    }),
  );
  expect(
    screen.getByRole("region", { name: "Configuración del paso" }),
  ).toBeInTheDocument();
});

it("rejects a canvas connection that closes a cycle", async () => {
  setup();
  fireEvent.click(await screen.findByRole("button", { name: "Nuevo flujo" }));
  fireEvent.click(screen.getByRole("button", { name: "Añadir paso" }));
  fireEvent.click(screen.getByRole("button", { name: "Conectar canvas" }));
  fireEvent.click(screen.getByRole("button", { name: "Guardar borrador" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Revisa");
  expect(
    vi.mocked(api).mock.calls.some(([, method]) => method === "POST"),
  ).toBe(false);
});

it("edits the method and target of an HTTP step", () => {
  let saved: WorkflowNode | undefined;
  const definition: WorkflowDefinition = {
    trigger: { type: "manual" },
    nodes: [{ id: "call", type: "http", method: "GET", url: "" }],
  };
  function Editor() {
    const [node, setNode] = React.useState<WorkflowNode>(definition.nodes[0]);
    saved = node;
    return (
      <QueryClientProvider client={new QueryClient()}>
        <StepEditor
          node={node}
          definition={definition}
          objects={[]}
          onChange={setNode}
        />
      </QueryClientProvider>
    );
  }
  render(<Editor />);
  fireEvent.change(screen.getByLabelText("Método"), {
    target: { value: "POST" },
  });
  fireEvent.change(screen.getByLabelText("Tipo de URL"), {
    target: { value: "ref" },
  });
  expect(saved).toMatchObject({ method: "POST" });
  expect(saved).toMatchObject({ url: { ref: "system.owner" } });
});

it("picks a child workflow and pins its published version", async () => {
  vi.mocked(api).mockImplementation(async (url: string) => ({
    data:
      url === "/workflows"
        ? [
            {
              id: "child-1",
              name: "Child",
              revision: 0,
              published_version: "child-1:0",
            },
          ]
        : {
            id: "child-1",
            name: "Child",
            revision: 0,
            published_version: "child-1:0",
            definition: {
              trigger: { type: "manual" },
              nodes: [{ id: "echo", type: "transform", values: {} }],
            },
          },
  }));
  let saved: WorkflowNode | undefined;
  const definition: WorkflowDefinition = {
    trigger: { type: "manual" },
    nodes: [
      {
        id: "call",
        type: "subflow",
        workflowId: "",
        workflowVersion: "",
        input: {},
      },
    ],
  };
  function Editor() {
    const [node, setNode] = React.useState<WorkflowNode>(definition.nodes[0]);
    saved = node;
    return (
      <QueryClientProvider client={new QueryClient()}>
        <StepEditor
          node={node}
          definition={definition}
          objects={[]}
          onChange={setNode}
        />
      </QueryClientProvider>
    );
  }
  render(<Editor />);
  await screen.findByRole("option", { name: "Child" });
  fireEvent.change(
    screen.getByLabelText("Flujo hijo", { selector: "select" }),
    {
      target: { value: "child-1" },
    },
  );
  expect(saved).toMatchObject({ workflowId: "child-1", workflowVersion: "" });
  fireEvent.click(
    await screen.findByRole("button", { name: "Usar versión publicada" }),
  );
  expect(saved).toMatchObject({ workflowVersion: "child-1:0" });
});

it("lists catalog pieces and edits their inputs", async () => {
  vi.mocked(api).mockImplementation(async (url: string) => ({
    data:
      url === "/workflow-pieces"
        ? [
            {
              id: "log",
              version: 1,
              label: "Log message",
              inputs: [
                {
                  key: "message",
                  label: "Message",
                  type: "text",
                  required: true,
                },
              ],
              outputs: ["message"],
            },
          ]
        : [],
  }));
  let saved: WorkflowNode | undefined;
  const definition: WorkflowDefinition = {
    trigger: { type: "manual" },
    nodes: [
      { id: "note", type: "piece", pieceId: "", pieceVersion: 1, config: {} },
    ],
  };
  function Editor() {
    const [node, setNode] = React.useState<WorkflowNode>(definition.nodes[0]);
    saved = node;
    return (
      <QueryClientProvider client={new QueryClient()}>
        <StepEditor
          node={node}
          definition={definition}
          objects={[]}
          onChange={setNode}
        />
      </QueryClientProvider>
    );
  }
  render(<Editor />);
  await screen.findByRole("option", { name: "Log message" });
  fireEvent.change(screen.getByLabelText("Pieza", { selector: "select" }), {
    target: { value: "log" },
  });
  expect(saved).toMatchObject({ pieceId: "log", pieceVersion: 1 });
  fireEvent.change(screen.getByLabelText("Message"), {
    target: { value: "hello" },
  });
  expect(saved).toMatchObject({ config: { message: "hello" } });
});

it("edits the body and budget of a loop step", () => {
  let saved: WorkflowNode | undefined;
  const definition: WorkflowDefinition = {
    trigger: { type: "manual" },
    nodes: [
      {
        id: "repeat",
        type: "loop",
        items: { ref: "trigger.tags" },
        body: "",
        next: "done",
      },
      { id: "done", type: "transform", values: {} },
    ],
  };
  function Editor() {
    const [node, setNode] = React.useState<WorkflowNode>(definition.nodes[0]);
    saved = node;
    return (
      <StepEditor
        node={node}
        definition={definition}
        objects={[]}
        onChange={setNode}
      />
    );
  }
  render(<Editor />);
  fireEvent.change(screen.getByLabelText("Primer paso del cuerpo"), {
    target: { value: "done" },
  });
  fireEvent.change(screen.getByLabelText("Máximo de iteraciones"), {
    target: { value: "5" },
  });
  expect(saved).toMatchObject({ body: "done", maxIterations: 5 });
});
