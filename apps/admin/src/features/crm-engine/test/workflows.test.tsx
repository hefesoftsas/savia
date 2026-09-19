import React from "react";
import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Workflows from "../workflows";
import { api } from "../api";
import { setCrmRuntime } from "../runtime";
vi.mock("../api", () => ({ api: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  setCrmRuntime({ embedded: false });
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
  setCrmRuntime({ embedded: true, domainId: "first" });
  const view = render(element());
  fireEvent.click(await screen.findByRole("button", { name: "Nuevo flujo" }));
  fireEvent.change(screen.getByLabelText("Nombre del flujo"), {
    target: { value: "Private first-domain draft" },
  });
  setCrmRuntime({ embedded: true, domainId: "second" });
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
