// @vitest-environment jsdom
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
import RecordDetail from "../record-detail";
import { api } from "../api";
import { setCrmRuntime } from "../runtime";
import { makeConfig } from "@savia/crm-shared/metadata";
vi.mock("../api", () => ({
  api: vi.fn(),
  crmFetch: vi.fn(),
  downloadCrm: vi.fn(),
}));
vi.mock("../record-links", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../record-links")>();
  return { ...actual, default: () => <div>CRM relationships content</div> };
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  setCrmRuntime({});
});
it("keeps CRM associations in their own tab and shows option labels in information", async () => {
  setCrmRuntime({ apiBasePath: "/v1/data-domains/sales" });
  const record = { id: "1", dealname: "Renovación anual", pipeline: "default" };
  vi.mocked(api).mockImplementation(async (path) =>
    path.startsWith("/record-links/")
      ? {
          data: [
            {
              definition: { id: "contacts", storage: "native" },
              direction: "outgoing",
              targetObject: "contacts",
              targetLabel: "Contactos",
              label: "Contactos",
              records: [],
              total: 1,
              canEdit: false,
            },
          ],
        }
      : { data: { record, relations: [] } },
  );
  const config = makeConfig({
    dealname: { type: "Textbox", label: "Nombre" },
    pipeline: {
      type: "Dropdown",
      label: "Pipeline",
      options: [{ value: "default", label: "Ventas" }],
    },
  });
  config.studio = {
    collection: {
      kind: "crm",
      sourceId: "hubspot",
      resource: "deals",
      capabilities: {
        list: true,
        read: true,
        create: false,
        update: false,
        delete: false,
        schema: false,
        customFields: false,
      },
    },
  };
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RecordDetail
        object={{ name: "deals", label: "Negocios", description: "", config }}
        record={record}
        onEdit={vi.fn()}
        onClose={vi.fn()}
        onRefresh={vi.fn()}
        onNavigate={vi.fn()}
      />
    </QueryClientProvider>,
  );
  expect(
    await screen.findByRole("heading", { name: "Renovación anual" }),
  ).toBeVisible();
  expect(screen.queryByText("Ficha del registro")).not.toBeInTheDocument();
  expect(await screen.findByText("Ventas")).toBeVisible();
  expect(screen.queryByText("default")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Relaciones" }),
  ).not.toBeInTheDocument();
  fireEvent.click(await screen.findByRole("button", { name: /Contactos/ }));
  expect(await screen.findByText("CRM relationships content")).toBeVisible();
});

it("shows declarative quote details and opens the selected detail", async () => {
  setCrmRuntime({ apiBasePath: "/v1/data-domains/platform" });
  const record = { id: "quote-1", name: "COT-20260917-P3ZJ" };
  const onNavigate = vi.fn();
  vi.mocked(api).mockImplementation(async (path) => {
    if (path.startsWith("/record-links/")) return { data: [] } as never;
    if (path.startsWith("/record-detail/"))
      return {
        data: {
          record,
          relations: [
            {
              object: "cotizaciones_detalle",
              label: "Detalles de cotización",
              field: "cotizacion",
              fieldLabel: "Cotización",
              direction: "incoming",
              total: 1,
              records: [
                {
                  id: "detail-1",
                  name: "COT-20260917-P3ZJ · Liberty · Integral",
                },
              ],
            },
          ],
        },
      } as never;
    return { data: [] } as never;
  });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RecordDetail
        object={{
          name: "cotizaciones",
          label: "Cotizaciones",
          description: "",
          config: makeConfig({
            name: { type: "Textbox", label: "Nombre" },
          }),
        }}
        record={record}
        onEdit={vi.fn()}
        onClose={vi.fn()}
        onNavigate={onNavigate}
        onRefresh={vi.fn()}
      />
    </QueryClientProvider>,
  );

  fireEvent.click(
    await screen.findByRole("button", { name: /Detalles de cotización/ }),
  );
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Abrir COT-20260917-P3ZJ · Liberty · Integral",
    }),
  );

  expect(onNavigate).toHaveBeenCalledWith("cotizaciones_detalle", "detail-1");
});

it("shows a right arrow when the record detail tabs overflow", async () => {
  setCrmRuntime({ apiBasePath: "/v1/data-domains/sales" });
  const record = { id: "1", dealname: "Renovación anual" };
  const relations = Array.from({ length: 10 }, (_, index) => ({
    definition: { id: `relation-${index}`, storage: "native" },
    direction: "outgoing",
    targetObject: "contacts",
    targetLabel: "Contactos",
    label: `Relación ${index + 1}`,
    records: [],
    total: index,
    canEdit: false,
  }));
  vi.mocked(api).mockImplementation(async (path) =>
    path.startsWith("/record-links/")
      ? { data: relations }
      : { data: { record, relations: [] } },
  );
  const config = makeConfig({ dealname: { type: "Textbox", label: "Nombre" } });
  config.studio = {
    collection: {
      kind: "crm",
      sourceId: "hubspot",
      resource: "deals",
      capabilities: {
        list: true,
        read: true,
        create: false,
        update: false,
        delete: false,
        schema: false,
        customFields: false,
      },
    },
  };
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RecordDetail
        object={{ name: "deals", label: "Negocios", description: "", config }}
        record={record}
        onEdit={vi.fn()}
        onClose={vi.fn()}
        onRefresh={vi.fn()}
        onNavigate={vi.fn()}
      />
    </QueryClientProvider>,
  );

  const tabLabel = await screen.findByText("Relación 1", { exact: true });
  const tablist = tabLabel.closest(".op-tabs-scroll") as HTMLElement;
  Object.defineProperties(tablist, {
    scrollWidth: { configurable: true, value: 1200 },
    clientWidth: { configurable: true, value: 500 },
    scrollLeft: { configurable: true, writable: true, value: 0 },
  });
  const scrollBy = vi.fn();
  Object.defineProperty(tablist, "scrollBy", {
    configurable: true,
    value: scrollBy,
  });
  fireEvent.scroll(tablist);

  const rightArrow = await screen.findByRole("button", {
    name: "Ver tabs a la derecha",
  });
  expect(rightArrow).toBeVisible();
  fireEvent.click(rightArrow);
  expect(scrollBy).toHaveBeenCalledWith(
    expect.objectContaining({ left: expect.any(Number) }),
  );
});
it("reloads the source before duplication and refuses stale data after an access failure", async () => {
  const record = { id: "source", name: "Old" };
  const onDuplicate = vi.fn();
  vi.mocked(api).mockResolvedValue({ data: { record, relations: [] } });
  const object = {
    name: "local",
    label: "Local",
    description: "",
    config: makeConfig({ name: { type: "Textbox", label: "Name" } }),
  };
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <RecordDetail
        object={object}
        record={record}
        onEdit={vi.fn()}
        onDuplicate={onDuplicate}
        onClose={vi.fn()}
        onRefresh={vi.fn()}
      />
    </QueryClientProvider>,
  );
  const button = await screen.findByRole("button", { name: "Duplicar" });
  vi.mocked(api).mockRejectedValueOnce(new Error("Acceso denegado"));
  fireEvent.click(button);
  expect(await screen.findByRole("alert")).toHaveTextContent("Acceso denegado");
  expect(onDuplicate).not.toHaveBeenCalled();
  vi.mocked(api).mockResolvedValue({
    data: { record: { ...record, name: "Current" }, relations: [] },
  });
  fireEvent.click(button);
  await waitFor(() =>
    expect(onDuplicate).toHaveBeenCalledWith({ ...record, name: "Current" }),
  );
  expect(record.name).toBe("Old");
  expect(vi.mocked(api).mock.calls.every((call) => !call[1])).toBe(true);
});
