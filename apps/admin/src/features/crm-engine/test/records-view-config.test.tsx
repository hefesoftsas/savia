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
  within,
} from "@testing-library/react";
import Root from "../app";
import { setCrmRuntime } from "../runtime";
import { makeConfig } from "@savia/crm-shared/metadata";

afterEach(async () => {
  cleanup();
  await new Promise((resolve) => setTimeout(resolve, 0));
  setCrmRuntime({ embedded: false });
});

const agencyProfiles = {
  name: "agency_profiles",
  label: "Perfiles de agencia",
  description: "",
  config: makeConfig({
    displayName: { type: "Textbox", label: "organization · displayName" },
    shortName: { type: "Textbox", label: "organization · shortName" },
    email: { type: "Textbox", label: "channels · email" },
    internalId: { type: "Textbox", label: "administration · id" },
  }),
};
const sourceAgencyProfiles = {
  ...agencyProfiles,
  config: {
    ...agencyProfiles.config,
    studio: {
      collection: {
        sourceId: "agency-network",
        resource: "agency-profiles",
        kind: "domain" as const,
        domain: "agency-network",
        collection: "agency-profiles",
        capabilities: {
          list: true,
          read: true,
          create: true,
          update: true,
          delete: false,
          schema: false,
          customFields: false,
          filter: true,
          sort: true,
        },
      },
    },
  },
};
const crmAgencyProfiles = {
  ...sourceAgencyProfiles,
  config: {
    ...sourceAgencyProfiles.config,
    studio: {
      ...sourceAgencyProfiles.config.studio,
      collection: {
        ...sourceAgencyProfiles.config.studio!.collection!,
        kind: "crm" as const,
      },
    },
  },
};

it("keeps configuration entry in the view controls instead of duplicating it in the record header", async () => {
  const transport = vi.fn(async (path: string) => {
    if (path === "/api/objects")
      return Response.json({ data: [sourceAgencyProfiles] });
    if (path === "/api/views/agency_profiles")
      return Response.json({ data: [] });
    if (path.startsWith("/api/records/agency_profiles"))
      return Response.json({
        data: [
          {
            id: "agency-1",
            displayName: "Savia",
            shortName: "SV",
            email: "hola@savia.test",
            internalId: "profile-1",
          },
        ],
        total: 1,
      });
    return Response.json({ data: {} });
  });
  setCrmRuntime({
    embedded: true,
    domainId: "platform",
    businessSetupEnabled: false,
    transport,
  });

  render(<Root embedded search="object=agency_profiles&view=records" />);

  expect(
    await screen.findByRole("button", { name: "Configurar vista" }),
  ).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Configurar" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Nuevo" })).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Nuevo registro" }),
  ).not.toBeInTheDocument();
  expect(await screen.findByText("Savia")).toBeVisible();
  expect(
    screen.queryByRole("checkbox", { name: "Seleccionar página" }),
  ).not.toBeInTheDocument();
});

it("shows CRM as the first icon-only records column", async () => {
  const transport = vi.fn(async (path: string) => {
    if (path === "/api/objects")
      return Response.json({ data: [crmAgencyProfiles] });
    if (path === "/api/views/agency_profiles")
      return Response.json({ data: [], default: null });
    if (path.startsWith("/api/records/agency_profiles"))
      return Response.json({
        data: [
          {
            id: "agency-1",
            displayName: "Savia",
            shortName: "SV",
            email: "hola@savia.test",
            internalId: "profile-1",
            _crmLinks: [
              {
                provider: "hubspot",
                label: "Contacto en HubSpot",
                url: "https://app.hubspot.com/contacts/51969008/record/0-1/247951049777",
              },
            ],
          },
        ],
        total: 1,
      });
    return Response.json({ data: {} });
  });
  setCrmRuntime({
    embedded: true,
    domainId: "platform",
    businessSetupEnabled: false,
    transport,
  });

  render(<Root embedded search="object=agency_profiles&view=records" />);

  const records = await screen.findByRole("region", {
    name: "Registros de Perfiles de agencia",
  });
  expect(within(records).getByText("Savia")).toBeVisible();
  const headers = within(records).getAllByRole("columnheader");
  expect(headers[0]).toHaveTextContent("CRM");
  const originLink = within(records).getByRole("link", {
    name: "Contacto en HubSpot",
  });
  expect(originLink.querySelector("svg")).not.toBeNull();
  expect(originLink.querySelector("span")).toBeNull();
});

it("lets CRM users hide the integration column from the table designer", async () => {
  let savedConfig: Record<string, unknown> | null = {
    columns: [
      "__crm_integration",
      "displayName",
      "shortName",
      "email",
      "internalId",
    ],
    columnOrder: [
      "__crm_integration",
      "displayName",
      "shortName",
      "email",
      "internalId",
    ],
    columnAliases: {},
  };
  const transport = vi.fn(async (path: string, init?: RequestInit) => {
    if (path === "/api/objects")
      return Response.json({ data: [crmAgencyProfiles] });
    if (path === "/api/views/agency_profiles")
      return Response.json({
        data: [],
        default: savedConfig ? { config: savedConfig } : null,
      });
    if (
      path === "/api/views/agency_profiles/default" &&
      init?.method === "PUT"
    ) {
      savedConfig = JSON.parse(String(init.body)).config;
      return Response.json({ data: { config: savedConfig } });
    }
    if (path.startsWith("/api/records/agency_profiles"))
      return Response.json({
        data: [
          {
            id: "agency-1",
            displayName: "Savia",
            shortName: "SV",
            email: "hola@savia.test",
            internalId: "profile-1",
            _crmLinks: [
              {
                provider: "hubspot",
                label: "Contacto en HubSpot",
                url: "https://app.hubspot.com/contacts/51969008/record/0-1/247951049777",
              },
            ],
          },
        ],
        total: 1,
      });
    return Response.json({ data: {} });
  });
  setCrmRuntime({
    embedded: true,
    domainId: "platform",
    businessSetupEnabled: false,
    transport,
  });

  render(<Root embedded search="object=agency_profiles&view=records" />);

  fireEvent.click(
    await screen.findByRole("button", { name: "Configurar vista" }),
  );
  const panel = screen.getByRole("dialog", { name: "Configurar vista" });
  const visibility = within(panel).getByRole("switch", {
    name: "Visible CRM",
  });
  expect(visibility).toHaveAttribute("aria-checked", "true");
  fireEvent.click(visibility);
  expect(visibility).toHaveAttribute("aria-checked", "false");

  fireEvent.click(
    within(panel).getByRole("button", { name: "Guardar cambios" }),
  );
  await waitFor(() =>
    expect(savedConfig?.columns).not.toContain("__crm_integration"),
  );
});

it("opens a stale record URL through the collection currently visible", async () => {
  const transport = vi.fn(async (path: string) => {
    if (path === "/api/objects")
      return Response.json({ data: [sourceAgencyProfiles] });
    if (path === "/api/views/agency_profiles")
      return Response.json({ data: [] });
    if (path === "/api/records/agency_profiles/12")
      return Response.json({
        data: {
          id: "12",
          displayName: "Agencia Norte",
          shortName: "AN",
          email: "norte@savia.test",
          internalId: "profile-12",
        },
      });
    if (path.startsWith("/api/records/agency_profiles"))
      return Response.json({
        data: [
          {
            id: "12",
            displayName: "Agencia Norte",
            shortName: "AN",
            email: "norte@savia.test",
            internalId: "profile-12",
          },
        ],
        total: 1,
      });
    if (path === "/api/records/clientes/12")
      return Response.json({ error: "El registro no existe." }, { status: 404 });
    return Response.json({ data: {} });
  });
  setCrmRuntime({
    embedded: true,
    domainId: "platform",
    businessSetupEnabled: false,
    transport,
  });

  render(<Root embedded search="object=clientes&view=records&record=12" />);

  expect(await screen.findByText("Agencia Norte")).toBeVisible();
  await waitFor(() =>
    expect(
      transport.mock.calls.some(
        ([path]) => path === "/api/records/agency_profiles/12",
      ),
    ).toBe(true),
  );
  expect(
    screen.queryByRole("heading", { name: "Registro no disponible" }),
  ).not.toBeInTheDocument();
});

it("replaces a stale collection name in an embedded record URL", async () => {
  const navigate = vi.fn();
  const transport = vi.fn(async (path: string) => {
    if (path === "/api/objects")
      return Response.json({ data: [sourceAgencyProfiles] });
    if (path === "/api/views/agency_profiles")
      return Response.json({ data: [] });
    if (path === "/api/records/agency_profiles/12")
      return Response.json({
        data: {
          id: "12",
          displayName: "Agencia Norte",
          shortName: "AN",
          email: "norte@savia.test",
          internalId: "profile-12",
        },
      });
    if (path.startsWith("/api/records/agency_profiles"))
      return Response.json({ data: [], total: 0 });
    return Response.json({ data: {} });
  });
  setCrmRuntime({
    embedded: true,
    domainId: "platform",
    businessSetupEnabled: false,
    transport,
    navigate,
  });

  render(<Root embedded search="object=clientes&view=records&record=12" />);

  await waitFor(() =>
    expect(navigate).toHaveBeenCalledWith(
      "object=agency_profiles&view=records&record=12",
      true,
    ),
  );
});

it("offers a CSV export for Agency profiles", async () => {
  const transport = vi.fn(async (path: string) => {
    if (path === "/api/objects")
      return Response.json({ data: [sourceAgencyProfiles] });
    if (path === "/api/views/agency_profiles")
      return Response.json({ data: [], default: null });
    if (path.startsWith("/api/records/agency_profiles"))
      return Response.json({ data: [], total: 0 });
    return Response.json({ data: {} });
  });
  setCrmRuntime({
    embedded: true,
    domainId: "platform",
    businessSetupEnabled: false,
    transport,
  });

  render(<Root embedded search="object=agency_profiles&view=records" />);

  expect(
    await screen.findByRole("button", { name: "Exportar a CSV" }),
  ).toBeVisible();
});

it("offers a CSV export for local record tables", async () => {
  const localObject = {
    name: "test",
    label: "Test",
    description: "",
    config: makeConfig({
      nombre: { type: "Textbox", label: "Nombre" },
      html_personalizado: { type: "FormHtml", label: "HTML personalizado" },
    }),
  };
  const transport = vi.fn(async (path: string) => {
    if (path === "/api/objects") return Response.json({ data: [localObject] });
    if (path === "/api/views/test")
      return Response.json({ data: [], default: null });
    if (path.startsWith("/api/records/test"))
      return Response.json({
        data: [{ id: "1", nombre: "Ejemplo", html_personalizado: "<p>Hola</p>" }],
        total: 1,
      });
    return Response.json({ data: {} });
  });
  setCrmRuntime({
    embedded: true,
    domainId: "platform",
    businessSetupEnabled: false,
    transport,
  });

  render(<Root embedded search="object=test&view=records" />);

  expect(
    await screen.findByRole("button", { name: "Exportar a CSV" }),
  ).toBeVisible();
});

it("keeps the trash action compact while preserving its accessible name", async () => {
  const transport = vi.fn(async (path: string) => {
    if (path === "/api/objects")
      return Response.json({ data: [agencyProfiles] });
    if (path === "/api/views/agency_profiles")
      return Response.json({ data: [], default: null });
    if (path.startsWith("/api/records/agency_profiles"))
      return Response.json({ data: [], total: 0 });
    return Response.json({ data: {} });
  });
  setCrmRuntime({
    embedded: true,
    domainId: "platform",
    businessSetupEnabled: false,
    transport,
  });

  render(<Root embedded search="object=agency_profiles&view=records" />);

  const trash = await screen.findByRole("button", { name: "Papelera" });
  expect(trash).not.toHaveTextContent("Papelera");
});

it("offers bulk selection for local collections that allow deletion", async () => {
  const transport = vi.fn(async (path: string) => {
    if (path === "/api/objects")
      return Response.json({ data: [agencyProfiles] });
    if (path === "/api/views/agency_profiles")
      return Response.json({ data: [], default: null });
    if (path.startsWith("/api/records/agency_profiles"))
      return Response.json({
        data: [
          {
            id: "agency-1",
            displayName: "Savia",
            shortName: "SV",
            email: "hola@savia.test",
            internalId: "profile-1",
          },
        ],
        total: 1,
      });
    return Response.json({ data: {} });
  });
  setCrmRuntime({
    embedded: true,
    domainId: "platform",
    businessSetupEnabled: false,
    transport,
  });

  render(<Root embedded search="object=agency_profiles&view=records" />);

  const records = await screen.findByRole("region", {
    name: "Registros de Perfiles de agencia",
  });
  expect(within(records).getAllByRole("checkbox")).toHaveLength(2);
  expect(
    screen.queryByRole("button", { name: "Eliminar seleccionados" }),
  ).not.toBeInTheDocument();
});

it("reveals directional controls for an overflowing records table", async () => {
  const transport = vi.fn(async (path: string) => {
    if (path === "/api/objects")
      return Response.json({ data: [sourceAgencyProfiles] });
    if (path === "/api/views/agency_profiles")
      return Response.json({ data: [], default: null });
    if (path.startsWith("/api/records/agency_profiles"))
      return Response.json({
        data: [
          {
            id: "agency-1",
            displayName: "Savia",
            shortName: "SV",
            email: "hola@savia.test",
            internalId: "profile-1",
          },
        ],
        total: 1,
      });
    return Response.json({ data: {} });
  });
  setCrmRuntime({
    embedded: true,
    domainId: "platform",
    businessSetupEnabled: false,
    transport,
  });

  render(<Root embedded search="object=agency_profiles&view=records" />);

  const records = await screen.findByRole("region", {
    name: "Registros de Perfiles de agencia",
  });
  const viewport = records.querySelector(
    '[data-slot="table-container"]',
  ) as HTMLDivElement;
  const scrollBy = vi.fn();
  Object.defineProperties(viewport, {
    clientWidth: { configurable: true, value: 480 },
    scrollLeft: { configurable: true, value: 0, writable: true },
    scrollWidth: { configurable: true, value: 1200 },
    scrollBy: { configurable: true, value: scrollBy },
  });

  fireEvent(window, new Event("resize"));

  const next = await screen.findByRole("button", {
    name: "Ver columnas a la derecha",
  });
  fireEvent.click(next);
  expect(scrollBy).toHaveBeenCalledWith({ left: 384, behavior: "smooth" });

  viewport.scrollLeft = 384;
  fireEvent.scroll(viewport);
  expect(
    await screen.findByRole("button", { name: "Ver columnas a la izquierda" }),
  ).toBeVisible();
});

it("explains how to recover after hiding every table column", async () => {
  const transport = vi.fn(async (path: string) => {
    if (path === "/api/objects")
      return Response.json({ data: [agencyProfiles] });
    if (path === "/api/views/agency_profiles")
      return Response.json({ data: [], default: null });
    if (path.startsWith("/api/records/agency_profiles"))
      return Response.json({ data: [], total: 0 });
    return Response.json({ data: {} });
  });
  setCrmRuntime({
    embedded: true,
    domainId: "platform",
    businessSetupEnabled: false,
    transport,
  });

  render(<Root embedded search="object=agency_profiles&view=records" />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Configurar vista" }),
  );
  const panel = screen.getByRole("dialog", { name: "Configurar vista" });
  fireEvent.click(
    within(panel).getByRole("button", { name: "Ocultar todas las columnas" }),
  );
  fireEvent.click(
    within(panel).getByRole("button", { name: "Cerrar configuración" }),
  );

  expect(await screen.findByText("No hay columnas visibles")).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Configurar columnas" }),
  ).toBeVisible();
});

it("exposes server-backed table filters for agency profiles", async () => {
  const transport = vi.fn(async (path: string) => {
    if (path === "/api/objects")
      return Response.json({ data: [sourceAgencyProfiles] });
    if (path === "/api/views/agency_profiles")
      return Response.json({ data: [], default: null });
    if (path.startsWith("/api/records/agency_profiles"))
      return Response.json({
        data: [
          {
            id: "agency-1",
            displayName: "Savia",
            shortName: "SV",
            email: "hola@savia.test",
            internalId: "profile-1",
          },
        ],
        total: 1,
      });
    return Response.json({ data: {} });
  });
  setCrmRuntime({
    embedded: true,
    domainId: "platform",
    businessSetupEnabled: false,
    transport,
  });

  render(<Root embedded search="object=agency_profiles&view=records" />);
  fireEvent.click(await screen.findByRole("button", { name: "Filtros" }));
  fireEvent.click(screen.getByRole("button", { name: "Añadir filtro" }));
  expect(
    screen.getByRole("combobox", { name: "Campo del filtro 1" }),
  ).toBeVisible();
  expect(
    screen.getByRole("combobox", { name: "Operador del filtro 1" }),
  ).toHaveTextContent("Contiene");
  fireEvent.change(screen.getByRole("textbox", { name: "Valor del filtro 1" }), {
    target: { value: "Agen" },
  });
  const recordRequests = () =>
    transport.mock.calls
      .map(([path]) => String(path))
      .filter((path) => path.includes("/api/records/agency_profiles"));
  expect(
    recordRequests().some((path) => decodeURIComponent(path).includes("Agen")),
  ).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Aplicar" }));
  await waitFor(() =>
    expect(
      recordRequests().some((path) => decodeURIComponent(path).includes("Agen")),
    ).toBe(true),
  );
});

it("lists custom views and deletes them from the configuration drawer", async () => {
  let savedViews = [
    {
      id: "view-test",
      name: "Test",
      config: {
        columns: ["displayName", "shortName"],
        columnOrder: ["displayName", "shortName"],
        columnAliases: {},
      },
    },
  ];
  const transport = vi.fn(async (path: string, init?: RequestInit) => {
    if (path === "/api/objects")
      return Response.json({ data: [sourceAgencyProfiles] });
    if (path === "/api/views/agency_profiles" && init?.method !== "DELETE")
      return Response.json({ data: savedViews, default: null });
    if (
      path === "/api/views/agency_profiles/view-test" &&
      init?.method === "DELETE"
    ) {
      savedViews = [];
      return Response.json({ data: { id: "view-test", deleted: true } });
    }
    if (path.startsWith("/api/records/agency_profiles"))
      return Response.json({
        data: [
          {
            id: "agency-1",
            displayName: "Savia",
            shortName: "SV",
            email: "hola@savia.test",
            internalId: "profile-1",
          },
        ],
        total: 1,
      });
    return Response.json({ data: {} });
  });
  setCrmRuntime({
    embedded: true,
    domainId: "platform",
    businessSetupEnabled: false,
    transport,
  });

  render(<Root embedded search="object=agency_profiles&view=records" />);
  expect(await screen.findByRole("button", { name: "Test" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Configurar vista" }));

  const panel = screen.getByRole("dialog", { name: "Configurar vista" });
  expect(
    within(panel).getByRole("heading", { name: "Mis vistas" }),
  ).toBeVisible();
  fireEvent.click(
    within(panel).getByRole("button", { name: "Eliminar vista Test" }),
  );
  const confirmation = await screen.findByRole("dialog", {
    name: "Eliminar vista Test",
  });
  fireEvent.click(
    within(confirmation).getByRole("button", { name: "Eliminar" }),
  );
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "Test" }),
    ).not.toBeInTheDocument(),
  );
});

it("opens a searchable table-column panel and restores the default selection", async () => {
  const transport = vi.fn(async (path: string) => {
    if (path === "/api/objects")
      return Response.json({ data: [agencyProfiles] });
    if (path === "/api/views/agency_profiles")
      return Response.json({ data: [] });
    if (path.startsWith("/api/records/agency_profiles"))
      return Response.json({
        data: [
          {
            id: "agency-1",
            displayName: "Savia",
            shortName: "SV",
            email: "hola@savia.test",
            internalId: "profile-1",
          },
        ],
        total: 1,
      });
    return Response.json({ data: {} });
  });
  setCrmRuntime({
    embedded: true,
    domainId: "platform",
    businessSetupEnabled: false,
    transport,
  });

  render(<Root embedded search="object=agency_profiles&view=records" />);

  fireEvent.click(
    await screen.findByRole("button", { name: "Configurar vista" }),
  );

  const panel = screen.getByRole("dialog", { name: "Configurar vista" });
  expect(within(panel).getByText("4 de 4 columnas visibles")).toBeVisible();
  expect(
    within(panel).getByRole("searchbox", { name: "Buscar columna" }),
  ).toBeVisible();
  expect(
    within(panel).getByRole("button", { name: "Restablecer columnas" }),
  ).toBeVisible();
  const hideAll = within(panel).getByRole("button", {
    name: "Ocultar todas las columnas",
  });
  fireEvent.click(hideAll);
  expect(within(panel).getByText("0 de 4 columnas visibles")).toBeVisible();
  fireEvent.click(
    within(panel).getByRole("button", { name: "Mostrar todas las columnas" }),
  );
  expect(within(panel).getByText("4 de 4 columnas visibles")).toBeVisible();
  expect(
    within(panel).getByRole("list", { name: "Columnas de la tabla" }),
  ).toBeVisible();

  fireEvent.change(
    within(panel).getByRole("searchbox", { name: "Buscar columna" }),
    { target: { value: "email" } },
  );
  expect(
    within(panel).getByRole("listitem", {
      name: "Campo channels · email",
    }),
  ).toBeVisible();
  expect(
    within(panel).queryByRole("listitem", {
      name: "Campo organization · displayName",
    }),
  ).not.toBeInTheDocument();

  const emailColumn = within(panel).getByRole("listitem", {
    name: "Campo channels · email",
  });
  expect(within(emailColumn).getByText("Visible")).toBeVisible();
  const emailVisibility = within(emailColumn).getByRole("switch", {
    name: "Visible channels · email",
  });
  expect(emailVisibility).toHaveAttribute("aria-checked", "true");
  fireEvent.click(emailVisibility);
  expect(emailVisibility).toHaveAttribute("aria-checked", "false");
  expect(within(emailColumn).getByText("Oculta")).toBeVisible();
  expect(within(panel).getByText("3 de 4 columnas visibles")).toBeVisible();
  fireEvent.click(
    within(panel).getByRole("button", { name: "Restablecer columnas" }),
  );
  expect(within(emailColumn).getByText("Visible")).toBeVisible();
  expect(within(panel).getByText("4 de 4 columnas visibles")).toBeVisible();
});

it("applies aliases, visibility and drag order to the current table only", async () => {
  const transport = vi.fn(async (path: string) => {
    if (path === "/api/objects")
      return Response.json({ data: [agencyProfiles] });
    if (path === "/api/views/agency_profiles")
      return Response.json({ data: [] });
    if (path.startsWith("/api/records/agency_profiles"))
      return Response.json({
        data: [
          {
            id: "agency-1",
            displayName: "Savia",
            shortName: "SV",
            email: "hola@savia.test",
            internalId: "profile-1",
          },
        ],
        total: 1,
      });
    return Response.json({ data: {} });
  });
  setCrmRuntime({
    embedded: true,
    domainId: "platform",
    businessSetupEnabled: false,
    transport,
  });

  render(<Root embedded search="object=agency_profiles&view=records" />);

  fireEvent.click(
    await screen.findByRole("button", { name: "Configurar vista" }),
  );

  const panel = screen.getByRole("dialog", { name: "Configurar vista" });
  fireEvent.change(
    within(panel).getByRole("textbox", {
      name: "Alias de organization · displayName",
    }),
    { target: { value: "Nombre de agencia" } },
  );

  const source = within(panel).getByRole("listitem", {
    name: "Campo organization · shortName",
  });
  const target = within(panel).getByRole("listitem", {
    name: "Campo organization · displayName",
  });
  expect(source).not.toHaveAttribute("draggable");
  fireEvent.dragStart(
    within(source).getByRole("button", { name: /Reordenar/ }),
  );
  fireEvent.dragOver(target);
  fireEvent.drop(target);

  fireEvent.click(
    within(panel).getByRole("switch", {
      name: "Visible organization · shortName",
    }),
  );

  expect(
    within(panel)
      .getAllByRole("listitem")
      .slice(0, 2)
      .map((item) => item.getAttribute("aria-label")),
  ).toEqual([
    "Campo organization · shortName",
    "Campo organization · displayName",
  ]);

  fireEvent.click(
    within(panel).getByRole("button", { name: "Cerrar configuración" }),
  );

  const records = await screen.findByRole("region", {
    name: "Registros de Perfiles de agencia",
  });
  expect(
    within(records).getByRole("columnheader", { name: "Nombre de agencia" }),
  ).toBeVisible();
  expect(
    within(records).queryByRole("columnheader", {
      name: "organization · shortName",
    }),
  ).not.toBeInTheDocument();
});

it("saves table aliases and restores them after reopening the records view", async () => {
  let defaultConfig: Record<string, unknown> | null = null;
  const transport = vi.fn(async (path: string, init?: RequestInit) => {
    if (path === "/api/objects")
      return Response.json({ data: [agencyProfiles] });
    if (path === "/api/views/agency_profiles")
      return Response.json({
        data: [],
        default: defaultConfig ? { config: defaultConfig } : null,
      });
    if (
      path === "/api/views/agency_profiles/default" &&
      init?.method === "PUT"
    ) {
      defaultConfig = JSON.parse(String(init.body)).config;
      return Response.json({ data: { config: defaultConfig } });
    }
    if (path.startsWith("/api/records/agency_profiles"))
      return Response.json({
        data: [
          {
            id: "agency-1",
            displayName: "Savia",
            shortName: "SV",
            email: "hola@savia.test",
            internalId: "profile-1",
          },
        ],
        total: 1,
      });
    return Response.json({ data: {} });
  });
  setCrmRuntime({
    embedded: true,
    domainId: "platform",
    businessSetupEnabled: false,
    transport,
  });

  const first = render(
    <Root embedded search="object=agency_profiles&view=records" />,
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "Configurar vista" }),
  );
  const panel = screen.getByRole("dialog", { name: "Configurar vista" });
  const save = within(panel).getByRole("button", { name: "Guardar cambios" });
  expect(save).toBeDisabled();
  fireEvent.change(
    within(panel).getByRole("textbox", {
      name: "Alias de organization · displayName",
    }),
    { target: { value: "Nombre de agencia" } },
  );
  expect(save).toBeEnabled();
  fireEvent.click(save);
  await waitFor(() =>
    expect(defaultConfig).toMatchObject({
      columnAliases: { displayName: "Nombre de agencia" },
    }),
  );

  first.unmount();
  render(<Root embedded search="object=agency_profiles&view=records" />);
  const records = await screen.findByRole("region", {
    name: "Registros de Perfiles de agencia",
  });
  await waitFor(() =>
    expect(
      within(records).getByRole("columnheader", {
        name: "Nombre de agencia",
      }),
    ).toBeVisible(),
  );
});

it("shows a per-row delete action for collections that allow deletion", async () => {
  const transport = vi.fn(async (path: string) => {
    if (path === "/api/objects")
      return Response.json({ data: [agencyProfiles] });
    if (path === "/api/views/agency_profiles")
      return Response.json({ data: [], default: null });
    if (path.startsWith("/api/records/agency_profiles"))
      return Response.json({
        data: [
          {
            id: "agency-1",
            displayName: "Savia",
            shortName: "SV",
            email: "hola@savia.test",
            internalId: "profile-1",
            _version: 1,
          },
        ],
        total: 1,
      });
    return Response.json({ data: {} });
  });
  setCrmRuntime({
    embedded: true,
    domainId: "platform",
    businessSetupEnabled: false,
    transport,
  });

  render(<Root embedded search="object=agency_profiles&view=records" />);

  const records = await screen.findByRole("region", {
    name: "Registros de Perfiles de agencia",
  });
  expect(
    within(records).getByRole("button", { name: "Eliminar Savia" }),
  ).toBeVisible();
});

it("hides per-row delete when the collection does not allow deletion", async () => {
  const transport = vi.fn(async (path: string) => {
    if (path === "/api/objects")
      return Response.json({ data: [sourceAgencyProfiles] });
    if (path === "/api/views/agency_profiles")
      return Response.json({ data: [], default: null });
    if (path.startsWith("/api/records/agency_profiles"))
      return Response.json({
        data: [
          {
            id: "agency-1",
            displayName: "Savia",
            shortName: "SV",
            email: "hola@savia.test",
            internalId: "profile-1",
            _version: 1,
          },
        ],
        total: 1,
      });
    return Response.json({ data: {} });
  });
  setCrmRuntime({
    embedded: true,
    domainId: "platform",
    businessSetupEnabled: false,
    transport,
  });

  render(<Root embedded search="object=agency_profiles&view=records" />);

  const records = await screen.findByRole("region", {
    name: "Registros de Perfiles de agencia",
  });
  expect(
    within(records).queryByRole("button", { name: /Eliminar/ }),
  ).not.toBeInTheDocument();
});

it("deletes a record from the row action after confirmation", async () => {
  let records = [
    {
      id: "agency-1",
      displayName: "Savia",
      shortName: "SV",
      email: "hola@savia.test",
      internalId: "profile-1",
      _version: 1,
    },
  ];
  const transport = vi.fn(async (path: string, init?: RequestInit) => {
    if (path === "/api/objects")
      return Response.json({ data: [agencyProfiles] });
    if (path === "/api/views/agency_profiles")
      return Response.json({ data: [], default: null });
    if (
      path === "/api/records/agency_profiles/agency-1?version=1" &&
      init?.method === "DELETE"
    ) {
      records = [];
      return Response.json({ data: { id: "agency-1", deleted: true } });
    }
    if (path.startsWith("/api/records/agency_profiles"))
      return Response.json({ data: records, total: records.length });
    return Response.json({ data: {} });
  });
  setCrmRuntime({
    embedded: true,
    domainId: "platform",
    businessSetupEnabled: false,
    transport,
  });

  render(<Root embedded search="object=agency_profiles&view=records" />);

  const recordsRegion = await screen.findByRole("region", {
    name: "Registros de Perfiles de agencia",
  });
  fireEvent.click(
    within(recordsRegion).getByRole("button", { name: "Eliminar Savia" }),
  );
  const confirmation = await screen.findByRole("dialog", {
    name: "Eliminar Savia",
  });
  fireEvent.click(
    within(confirmation).getByRole("button", { name: "Mover a papelera" }),
  );
  await waitFor(() =>
    expect(
      transport.mock.calls.some(
        ([path, init]) =>
          path === "/api/records/agency_profiles/agency-1?version=1" &&
          init?.method === "DELETE",
      ),
    ).toBe(true),
  );
  await waitFor(() =>
    expect(within(recordsRegion).queryByText("Savia")).not.toBeInTheDocument(),
  );
});

it("deletes selected records through the bulk action after confirmation", async () => {
  let records = [
    {
      id: "agency-1",
      displayName: "Savia",
      shortName: "SV",
      email: "hola@savia.test",
      internalId: "profile-1",
      _version: 1,
    },
    {
      id: "agency-2",
      displayName: "Norte",
      shortName: "NR",
      email: "norte@savia.test",
      internalId: "profile-2",
      _version: 2,
    },
  ];
  const transport = vi.fn(async (path: string, init?: RequestInit) => {
    if (path === "/api/objects")
      return Response.json({ data: [agencyProfiles] });
    if (path === "/api/views/agency_profiles")
      return Response.json({ data: [], default: null });
    if (
      path === "/api/records/agency_profiles/bulk" &&
      init?.method === "POST"
    ) {
      const body = JSON.parse(String(init.body)) as {
        action: string;
        records: Array<{ id: string; version: number }>;
      };
      expect(body.action).toBe("delete");
      expect(body.records).toEqual([
        { id: "agency-1", version: 1 },
        { id: "agency-2", version: 2 },
      ]);
      records = records.filter(
        (record) => !body.records.some((row) => row.id === record.id),
      );
      return Response.json({
        data: body.records.map((row) => ({ id: row.id, ok: true })),
      });
    }
    if (path.startsWith("/api/records/agency_profiles"))
      return Response.json({ data: records, total: records.length });
    return Response.json({ data: {} });
  });
  setCrmRuntime({
    embedded: true,
    domainId: "platform",
    businessSetupEnabled: false,
    transport,
  });

  render(<Root embedded search="object=agency_profiles&view=records" />);

  const recordsRegion = await screen.findByRole("region", {
    name: "Registros de Perfiles de agencia",
  });
  const rowCheckboxes = within(recordsRegion).getAllByRole("checkbox");
  fireEvent.click(rowCheckboxes[1]);
  fireEvent.click(rowCheckboxes[2]);
  fireEvent.click(
    await screen.findByRole("button", { name: "Eliminar seleccionados" }),
  );
  const confirmation = await screen.findByRole("dialog", {
    name: "Eliminar 2 registros",
  });
  fireEvent.click(
    within(confirmation).getByRole("button", { name: "Mover a papelera" }),
  );
  await waitFor(() =>
    expect(
      transport.mock.calls.some(
        ([path, init]) =>
          path === "/api/records/agency_profiles/bulk" &&
          init?.method === "POST",
      ),
    ).toBe(true),
  );
  await waitFor(() =>
    expect(within(recordsRegion).queryByText("Savia")).not.toBeInTheDocument(),
  );
  expect(within(recordsRegion).queryByText("Norte")).not.toBeInTheDocument();
});

it("does not offer bulk delete for collections without delete capability", async () => {
  const transport = vi.fn(async (path: string) => {
    if (path === "/api/objects")
      return Response.json({ data: [sourceAgencyProfiles] });
    if (path === "/api/views/agency_profiles")
      return Response.json({ data: [], default: null });
    if (path.startsWith("/api/records/agency_profiles"))
      return Response.json({
        data: [
          {
            id: "agency-1",
            displayName: "Savia",
            shortName: "SV",
            email: "hola@savia.test",
            internalId: "profile-1",
            _version: 1,
          },
        ],
        total: 1,
      });
    return Response.json({ data: {} });
  });
  setCrmRuntime({
    embedded: true,
    domainId: "platform",
    businessSetupEnabled: false,
    transport,
  });

  render(<Root embedded search="object=agency_profiles&view=records" />);

  const recordsRegion = await screen.findByRole("region", {
    name: "Registros de Perfiles de agencia",
  });
  expect(
    within(recordsRegion).queryByRole("checkbox"),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Eliminar seleccionados" }),
  ).not.toBeInTheDocument();
});

it("saves source-form column layout from the records configuration drawer", async () => {
  let savedObject: Record<string, unknown> | null = null;
  const transport = vi.fn(async (path: string, init?: RequestInit) => {
    if (path === "/api/objects")
      return Response.json({ data: [sourceAgencyProfiles] });
    if (path === "/api/objects/agency_profiles" && init?.method === "PUT") {
      savedObject = JSON.parse(String(init.body));
      return Response.json({ data: savedObject });
    }
    if (path === "/api/views/agency_profiles")
      return Response.json({ data: [], default: null });
    if (path.startsWith("/api/records/agency_profiles"))
      return Response.json({
        data: [
          {
            id: "agency-1",
            displayName: "Savia",
            shortName: "SV",
            email: "hola@savia.test",
            internalId: "profile-1",
          },
        ],
        total: 1,
      });
    return Response.json({ data: {} });
  });
  setCrmRuntime({
    embedded: true,
    domainId: "platform",
    businessSetupEnabled: false,
    transport,
  });

  render(<Root embedded search="object=agency_profiles&view=records" />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Configurar vista" }),
  );
  const panel = screen.getByRole("dialog", { name: "Configurar vista" });
  fireEvent.click(within(panel).getByRole("tab", { name: "Formulario" }));
  expect(
    within(panel).queryByRole("combobox", {
      name: "Columnas del formulario",
    }),
  ).not.toBeInTheDocument();
  const oneColumn = within(panel).getByRole("radio", {
    name: "Una columna",
  });
  const twoColumns = within(panel).getByRole("radio", {
    name: "Dos columnas",
  });
  expect(oneColumn).toBeChecked();
  expect(
    within(panel).getByTestId("form-layout-preview-1"),
  ).toBeVisible();
  expect(
    within(panel).getByTestId("form-layout-preview-2"),
  ).toBeVisible();
  fireEvent.click(twoColumns);
  expect(twoColumns).toBeChecked();
  fireEvent.click(
    within(panel).getByRole("button", { name: "Guardar cambios" }),
  );
  await waitFor(() =>
    expect(savedObject).toMatchObject({
      config: { studio: { columns: 2 } },
    }),
  );
});
