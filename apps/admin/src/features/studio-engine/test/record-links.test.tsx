// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { render } from "./locale-test-render";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import RecordLinks from "../record-links";
import { api } from "../api";
import {
  makeConfig,
  type StudioObject,
  type StudioRecord,
} from "@savia/studio-shared/metadata";
vi.mock("../api", () => ({ api: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
const object: StudioObject = {
  name: "clients",
  label: "Clientes",
  description: "",
  config: makeConfig({}),
};
const record = { id: "client/1" } as StudioRecord;
const group = {
  definition: { id: "rel1", storage: "local" },
  direction: "outgoing",
  targetObject: "agencies",
  targetLabel: "Agencias",
  label: "Agencia",
  records: [{ id: "a/1", label: "Agencia Norte" }],
  total: 1,
  canEdit: true,
};
function setup() {
  const navigate = vi.fn();
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <RecordLinks object={object} record={record} onNavigate={navigate} />
    </QueryClientProvider>,
  );
  return navigate;
}
it("navigates linked records and deletes only the association", async () => {
  vi.mocked(api).mockResolvedValue({ data: [group] });
  const navigate = setup();
  fireEvent.click(await screen.findByRole("button", { name: "Agencia Norte" }));
  expect(navigate).toHaveBeenCalledWith("agencies", "a/1");
  fireEvent.click(
    screen.getByRole("button", { name: "Desvincular Agencia Norte" }),
  );
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(
      "/record-links/clients/client%2F1/rel1",
      "DELETE",
      { targetId: "a/1" },
    ),
  );
});
it("loads candidates without unsupported query filters and submits target id", async () => {
  vi.mocked(api).mockImplementation(async (path) =>
    path.startsWith("/records/")
      ? { data: [{ id: "a2", name: "Sur" }], total: 1 }
      : { data: [group] },
  );
  setup();
  fireEvent.click(
    await screen.findByRole("button", { name: "Vincular registro" }),
  );
  await screen.findByRole("option", { name: "Sur" });
  expect(api).toHaveBeenCalledWith("/records/agencies?page=1&perPage=20");
  fireEvent.change(screen.getByLabelText("Registro de Agencias"), {
    target: { value: "a2" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Vincular", exact: true }),
  );
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(
      "/record-links/clients/client%2F1/rel1",
      "POST",
      { targetId: "a2" },
    ),
  );
});
it("shows backend mutation errors without removing the record", async () => {
  vi.mocked(api).mockImplementation(async (_path, method) => {
    if (method === "DELETE") throw new Error("Relación administrada en origen");
    return { data: [group] };
  });
  setup();
  fireEvent.click(
    await screen.findByRole("button", { name: "Desvincular Agencia Norte" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Relación administrada en origen",
  );
  expect(screen.getByRole("button", { name: "Agencia Norte" })).toBeVisible();
});

it("keeps missing targets unlinkable without offering navigation", async () => {
  vi.mocked(api).mockResolvedValue({
    data: [
      {
        ...group,
        records: [
          { id: "gone", label: "Registro no disponible (gone)", missing: true },
        ],
      },
    ],
  });
  setup();
  expect(
    await screen.findByText("Registro no disponible (gone)"),
  ).toBeVisible();
  expect(
    screen.queryByRole("button", {
      name: "Registro no disponible (gone)",
      exact: true,
    }),
  ).not.toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", {
      name: "Desvincular Registro no disponible (gone)",
    }),
  );
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(
      "/record-links/clients/client%2F1/rel1",
      "DELETE",
      { targetId: "gone" },
    ),
  );
});
it("shows the HubSpot empty state without suggesting local relationship configuration", async () => {
  vi.mocked(api).mockResolvedValue({ data: [] });
  const studioObject = {
    ...object,
    config: {
      ...object.config,
      studio: {
        collection: {
          sourceId: "hubspot",
          resource: "deals",
          kind: "crm" as const,
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
      },
    },
  };
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RecordLinks object={studioObject} record={record} onNavigate={vi.fn()} />
    </QueryClientProvider>,
  );
  expect(
    await screen.findByText("No hay registros relacionados en HubSpot."),
  ).toBeVisible();
  expect(screen.queryByText(/Puedes definirlas/)).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Vincular registro" }),
  ).not.toBeInTheDocument();
});
it("labels HubSpot contact candidates by their full name before their email", async () => {
  vi.mocked(api).mockImplementation(async (path) =>
    path.startsWith("/records/")
      ? {
          data: [
            {
              id: "contact-1",
              firstname: "Ana",
              lastname: "López",
              email: "ana@example.test",
            },
          ],
          total: 1,
        }
      : { data: [group] },
  );
  setup();
  fireEvent.click(
    await screen.findByRole("button", { name: "Vincular registro" }),
  );
  expect(
    await screen.findByRole("option", { name: "Ana López" }),
  ).toBeVisible();
  expect(
    screen.queryByRole("option", { name: "ana@example.test" }),
  ).not.toBeInTheDocument();
});

it("shows one related-record group at a time through tabs", async () => {
  const secondGroup = {
    ...group,
    definition: { id: "rel2", storage: "native" },
    targetObject: "contacts",
    targetLabel: "Contactos",
    label: "Contacto",
    readOnlyReason: "Identidad sincronizada con HubSpot.",
    records: [{ id: "c/1", label: "Ana López" }],
  };
  vi.mocked(api).mockResolvedValue({ data: [group, secondGroup] });
  setup();

  expect(await screen.findByRole("tab", { name: /Agencia/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  expect(
    screen.queryByText("Relación nativa · administrada en su origen"),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByText("Identidad sincronizada con HubSpot."),
  ).not.toBeInTheDocument();
  expect(screen.getByText("Agencia Norte")).toBeVisible();
  expect(screen.queryByText("Ana López")).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole("tab", { name: /Contacto/ }));
  expect(
    screen.queryByText("Relación nativa · administrada en su origen"),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByText("Identidad sincronizada con HubSpot."),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("heading", { name: /Contacto/ }),
  ).not.toBeInTheDocument();
  expect(screen.getByText("Ana López")).toBeVisible();
  expect(screen.queryByText("Agencia Norte")).not.toBeInTheDocument();
});

it("renders the active relation as a table and destroys it when another relation is selected", async () => {
  const tableGroup = {
    ...group,
    targetColumns: [
      { key: "name", label: "Nombre" },
      { key: "email", label: "Correo" },
    ],
    records: [
      {
        id: "a/1",
        label: "Agencia Norte",
        data: { id: "a/1", name: "Agencia Norte", email: "ana@example.test" },
      },
    ],
  };
  const secondGroup = {
    ...tableGroup,
    definition: { id: "rel2", storage: "native" },
    targetObject: "contacts",
    targetLabel: "Contactos",
    label: "Contacto",
    records: [
      {
        id: "c/1",
        label: "Ana López",
        data: { id: "c/1", firstname: "Ana", lastname: "López" },
      },
    ],
    targetColumns: [
      { key: "firstname", label: "Nombres" },
      { key: "lastname", label: "Apellidos" },
    ],
  };
  vi.mocked(api).mockResolvedValue({ data: [tableGroup, secondGroup] });
  setup();

  expect(await screen.findByRole("table", { name: /Agencia/ })).toBeVisible();
  expect(screen.getByRole("columnheader", { name: "Nombre" })).toBeVisible();
  expect(screen.getByRole("cell", { name: "Agencia Norte" })).toBeVisible();
  expect(
    screen.queryByRole("table", { name: /Contacto/ }),
  ).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole("tab", { name: /Contacto/ }));

  await waitFor(() => {
    expect(
      screen.queryByRole("table", { name: /Agencia/ }),
    ).not.toBeInTheDocument();
  });
  expect(await screen.findByRole("table", { name: /Contacto/ })).toBeVisible();
  expect(screen.getByRole("columnheader", { name: "Nombres" })).toBeVisible();
  expect(screen.getByRole("cell", { name: "Ana" })).toBeVisible();
});

it("shows arrows and scrolls overflowing relation tabs and tables", async () => {
  const tableGroup = {
    ...group,
    targetColumns: [
      { key: "name", label: "Nombre" },
      { key: "email", label: "Correo" },
    ],
    records: [
      {
        id: "a/1",
        label: "Agencia Norte",
        data: { id: "a/1", name: "Agencia Norte", email: "ana@example.test" },
      },
    ],
  };
  const secondGroup = {
    ...tableGroup,
    definition: { id: "rel2", storage: "native" },
    targetObject: "contacts",
    targetLabel: "Contactos",
    label: "Contacto",
  };
  vi.mocked(api).mockResolvedValue({ data: [tableGroup, secondGroup] });
  setup();

  const tablist = await screen.findByRole("tablist");
  Object.defineProperties(tablist, {
    scrollWidth: { configurable: true, value: 900 },
    clientWidth: { configurable: true, value: 320 },
    scrollLeft: { configurable: true, writable: true, value: 0 },
  });
  const tabScrollBy = vi.fn();
  Object.defineProperty(tablist, "scrollBy", {
    configurable: true,
    value: tabScrollBy,
  });
  fireEvent.scroll(tablist);

  const tabsRight = await screen.findByRole("button", {
    name: "Ver tabs a la derecha",
  });
  expect(tabsRight).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Ver tabs a la izquierda" }),
  ).not.toBeInTheDocument();
  fireEvent.click(tabsRight);
  expect(tabScrollBy).toHaveBeenCalledWith(
    expect.objectContaining({ left: expect.any(Number) }),
  );

  const tableViewport = screen
    .getByRole("table", { name: /Agencia/ })
    .closest(".related-records-table") as HTMLElement;
  Object.defineProperties(tableViewport, {
    scrollWidth: { configurable: true, value: 1200 },
    clientWidth: { configurable: true, value: 500 },
    scrollLeft: { configurable: true, writable: true, value: 0 },
  });
  const tableScrollBy = vi.fn();
  Object.defineProperty(tableViewport, "scrollBy", {
    configurable: true,
    value: tableScrollBy,
  });
  fireEvent.scroll(tableViewport);

  const columnsRight = await screen.findByRole("button", {
    name: "Ver columnas a la derecha",
  });
  expect(columnsRight).toBeVisible();
  fireEvent.click(columnsRight);
  expect(tableScrollBy).toHaveBeenCalledWith(
    expect.objectContaining({ left: expect.any(Number) }),
  );
});
