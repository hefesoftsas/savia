import React from "react";
import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { render } from "./locale-test-render";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Workflows from "../workflows";
import { api } from "../api";
import { setStudioRuntime } from "../runtime";
import { TriggerEditor } from "../workflow-editor";
import { TriggerConditions } from "../workflow-trigger-conditions";
import { makeConfig } from "@savia/studio-shared/metadata";
import {
  workflowDefinitionSchema,
  type WorkflowDefinition,
  type WorkflowTriggerCondition,
} from "@savia/studio-shared/workflows";
vi.mock("../api", () => ({ api: vi.fn() }));
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
it("clears an unsaved draft when the data domain changes", async () => {
  vi.mocked(api).mockResolvedValue({ data: [] });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const element = () => (
    <QueryClientProvider client={client}>
      <Workflows objects={[]} />
    </QueryClientProvider>
  );
  setStudioRuntime({ embedded: true, domainId: "first" });
  const view = render(element());
  fireEvent.click(await screen.findByRole("button", { name: "Nuevo flujo" }));
  fireEvent.change(screen.getByLabelText("Nombre del flujo"), {
    target: { value: "Private first-domain draft" },
  });
  setStudioRuntime({ embedded: true, domainId: "second" });
  view.rerender(element());
  expect(
    screen.queryByDisplayValue("Private first-domain draft"),
  ).not.toBeInTheDocument();
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
