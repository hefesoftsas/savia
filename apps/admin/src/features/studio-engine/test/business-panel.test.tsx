// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { render } from "./locale-test-render";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BusinessPanel, CustomerActions } from "../business-panel";
import { api, studioFetch } from "../api";
vi.mock("../api", () => ({
  api: vi.fn(),
  studioFetch: vi.fn(),
  downloadCrm: vi.fn(),
}));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
function mount(child: React.ReactNode) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      {child}
    </QueryClientProvider>,
  );
}
it("installs templates explicitly and refreshes objects, preserving error recovery", async () => {
  const saved = vi.fn();
  let fail = true;
  vi.mocked(api).mockImplementation(async (_url, method) => {
    if (method === "POST" && fail) throw new Error("No disponible");
    return { data: { installed: method === "POST" } };
  });
  mount(<BusinessPanel onInstalled={saved} />);
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Instalar Clientes y Cotizaciones",
    }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent("No disponible");
  expect(saved).not.toHaveBeenCalled();
  fail = false;
  fireEvent.click(
    screen.getByRole("button", { name: "Instalar Clientes y Cotizaciones" }),
  );
  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
});
it("loads saved HubSpot state and only synchronizes after an explicit click", async () => {
  vi.mocked(api).mockResolvedValue({
    data: { status: "synced", externalObjectId: "123" },
  });
  mount(
    <CustomerActions
      objectName="clientes"
      recordId="c1"
      onQuotation={vi.fn()}
      onRefresh={vi.fn()}
    />,
  );
  expect(await screen.findByText(/Sincronizado/)).toBeTruthy();
  expect(vi.mocked(api).mock.calls.every((call) => call[1] !== "POST")).toBe(
    true,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Sincronizar con HubSpot" }),
  );
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith("/business/clientes/c1/hubspot", "POST"),
  );
});
it("reuses quotation attempt key after a lost response and opens the returned record", async () => {
  const opened = vi.fn();
  let fail = true;
  vi.mocked(api).mockImplementation(async (path) => {
    if (path.endsWith("/quotations")) {
      if (fail) throw new Error("Conexión interrumpida");
      return { data: { id: "q1" } };
    }
    return { data: { status: "not_synced" } };
  });
  mount(
    <CustomerActions
      objectName="clientes"
      recordId="c1"
      onQuotation={opened}
      onRefresh={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Crear cotización" }));
  await screen.findByText("Conexión interrumpida");
  fail = false;
  fireEvent.click(screen.getByRole("button", { name: "Crear cotización" }));
  await waitFor(() => expect(opened).toHaveBeenCalledWith({ id: "q1" }));
  const calls = vi
    .mocked(api)
    .mock.calls.filter((call) => call[0].endsWith("/quotations"));
  expect(calls[0][3]).toEqual(calls[1][3]);
});
it("opens API documentation in a new browser tab", () => {
  const open = vi.spyOn(window, "open").mockImplementation(() => null);
  vi.mocked(api).mockResolvedValue({ data: { installed: true } });
  mount(<BusinessPanel onInstalled={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Consultar API" }));
  expect(open).toHaveBeenCalledWith(
    new URL("/api/docs", window.location.origin).toString(),
    "_blank",
    "noopener,noreferrer",
  );
  open.mockRestore();
});
it("opens scoped API documentation when embedded in Savia", async () => {
  const { setStudioRuntime } = await import("../runtime");
  const open = vi.spyOn(window, "open").mockImplementation(() => null);
  setStudioRuntime({
    embedded: true,
    apiBasePath: "/v1/dynamic-crm/101",
    transport: vi.fn(),
  });
  vi.mocked(api).mockResolvedValue({ data: { installed: true } });
  mount(<BusinessPanel onInstalled={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Consultar API" }));
  expect(open).toHaveBeenCalledWith(
    new URL("/v1/dynamic-crm/101/api/docs", window.location.origin).toString(),
    "_blank",
    "noopener,noreferrer",
  );
  open.mockRestore();
  setStudioRuntime({ embedded: false });
});

it("isolates cached and late business responses when the agency switches", async () => {
  const { setStudioRuntime } = await import("../runtime");
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  let finishA!: (response: Response) => void;
  const agencyA = vi.fn(
    () =>
      new Promise<Response>((resolve) => {
        finishA = resolve;
      }),
  );
  const agencyB = vi.fn(async () =>
    Response.json({ data: { installed: false } }),
  );
  setStudioRuntime({
    embedded: true,
    apiBasePath: "/v1/dynamic-crm/1",
    transport: agencyA,
  });
  const content = () => (
    <QueryClientProvider client={client}>
      <BusinessPanel onInstalled={vi.fn()} />
    </QueryClientProvider>
  );
  const view = render(content());
  await waitFor(() => expect(agencyA).toHaveBeenCalledOnce());
  setStudioRuntime({
    embedded: true,
    apiBasePath: "/v1/dynamic-crm/2",
    transport: agencyB,
  });
  view.rerender(content());
  await screen.findByRole("button", {
    name: "Instalar Clientes y Cotizaciones",
  });
  finishA(Response.json({ data: { installed: true } }));
  await waitFor(() =>
    expect(
      client.getQueryData(["business-setup", "/v1/dynamic-crm/1"]),
    ).toEqual({ data: { installed: true } }),
  );
  expect(screen.queryByText("Clientes y Cotizaciones disponibles.")).toBeNull();
  expect(agencyB).toHaveBeenCalledOnce();
  setStudioRuntime({
    embedded: true,
    apiBasePath: "/v1/dynamic-crm/1",
    transport: agencyA,
  });
  view.rerender(content());
  await screen.findByText("Clientes y Cotizaciones disponibles.");
  setStudioRuntime({
    embedded: true,
    apiBasePath: "/v1/dynamic-crm/2",
    transport: agencyB,
  });
  view.rerender(content());
  await screen.findByRole("button", {
    name: "Instalar Clientes y Cotizaciones",
  });
  setStudioRuntime({ embedded: false });
});
