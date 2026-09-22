// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { render } from "./studio-test-render";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import CollectionSourcesPanel, {
  CollectionLayoutDesigner,
} from "../collection-sources-panel";
import {
  collectionCapabilities,
  supportsLocalRecordTools,
} from "../collection-capabilities";
import { setCrmRuntime } from "../runtime";
import { makeConfig, type CrmObject } from "@savia/crm-shared/metadata";
const caps = {
  list: true,
  read: true,
  create: false,
  update: false,
  delete: false,
  schema: false,
  customFields: false,
};
const source = {
  id: "external",
  label: "CRM externo",
  kind: "jsonapi",
  baseUrl: "https://example.test/v1",
  hasToken: true,
};
const catalog = [
  {
    domain: "customer-portfolio",
    collection: "customer-profiles",
    title: "Clientes originales",
    capabilities: caps,
  },
];
const object: CrmObject = {
  name: "external_contacts",
  label: "Contactos",
  description: "",
  config: makeConfig({
    name: { type: "Textbox", label: "Nombre" },
    email: { type: "Textbox", label: "Correo" },
  }),
};
const inspection = {
  resourceType: "contacts",
  fields: {
    name: { type: "Textbox", label: "Nombre" },
    active: { type: "Toggle", label: "Activo" },
    company: { type: "Textbox", label: "Empresa" },
  },
  relationships: { company: { type: "companies" } },
  total: 1124,
  hasNext: true,
};
function mockTransport(bindings: Array<{ name: string }> = []) {
  return vi.fn(async (path: string, init?: RequestInit) => {
    if (path === "/api/sources/external/inspect" && init?.method === "POST")
      return Response.json({ data: inspection });
    return Response.json({
      data:
        init?.method === "POST"
          ? path === "/api/sources"
            ? source
            : object
          : path === "/api/sources"
            ? [source]
            : path === "/api/collection-catalog"
              ? catalog
              : path === "/api/collection-bindings"
                ? bindings
                : [],
    });
  });
}
function mount(element: React.ReactNode) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      {element}
    </QueryClientProvider>,
  );
}
function openSourcesTab() {
  fireEvent.click(screen.getByRole("tab", { name: "Fuentes externas" }));
}
afterEach(() => {
  cleanup();
  setCrmRuntime({ embedded: false });
});
it("loads catalog without writes and binds a domain collection to a screen", async () => {
  const transport = mockTransport();
  const bound = vi.fn();
  setCrmRuntime({ embedded: true, domainId: "platform", transport });
  mount(<CollectionSourcesPanel onBound={bound} />);
  await screen.findByRole("option", {
    name: "Clientes originales · customer-portfolio",
  });
  expect(transport.mock.calls.every(([, init]) => init?.method === "GET")).toBe(
    true,
  );
  fireEvent.change(screen.getByLabelText("Colección"), {
    target: { value: "customer-portfolio/customer-profiles" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Pantalla" }));
  fireEvent.change(screen.getByLabelText("Identificador de la pantalla"), {
    target: { value: "original_customers" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Vincular colección" }));
  await waitFor(() => expect(bound).toHaveBeenCalledWith(object));
  expect(transport).toHaveBeenCalledWith(
    "/api/collection-bindings",
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({
        name: "original_customers",
        label: "Clientes originales",
        domain: "customer-portfolio",
        collection: "customer-profiles",
      }),
    }),
  );
});
it("proposes the next valid identifier and preserves a manual edit", async () => {
  const transport = mockTransport([{ name: "clientes_originales" }]);
  setCrmRuntime({ embedded: true, domainId: "platform", transport });
  mount(<CollectionSourcesPanel onBound={() => {}} />);
  await screen.findByRole("option", {
    name: "Clientes originales · customer-portfolio",
  });
  fireEvent.change(screen.getByLabelText("Colección"), {
    target: { value: "customer-portfolio/customer-profiles" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Pantalla" }));
  expect(screen.getByLabelText("Identificador de la pantalla")).toHaveValue(
    "clientes_originales_2",
  );
  fireEvent.change(screen.getByLabelText("Identificador de la pantalla"), {
    target: { value: "clientes_prioritarios" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Origen" }));
  fireEvent.change(screen.getByLabelText("Colección"), {
    target: { value: "" },
  });
  fireEvent.change(screen.getByLabelText("Colección"), {
    target: { value: "customer-portfolio/customer-profiles" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Pantalla" }));
  expect(screen.getByLabelText("Identificador de la pantalla")).toHaveValue(
    "clientes_prioritarios",
  );
});
it("separates source configuration from collection bindings without losing a draft", async () => {
  const transport = mockTransport();
  setCrmRuntime({ embedded: true, domainId: "platform", transport });
  mount(<CollectionSourcesPanel onBound={() => {}} />);
  await screen.findByRole("option", {
    name: "Clientes originales · customer-portfolio",
  });
  expect(screen.getByRole("tab", { name: "Vincular" })).toHaveAttribute(
    "data-state",
    "active",
  );
  fireEvent.click(screen.getByRole("button", { name: "Pantalla" }));
  fireEvent.change(screen.getByLabelText("Identificador de la pantalla"), {
    target: { value: "clientes_borrador" },
  });
  openSourcesTab();
  expect(
    screen.getByRole("heading", { name: "Fuentes configuradas" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("heading", {
      name: "Vincular colección a una pantalla",
    }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("tab", { name: "Vincular" }));
  fireEvent.click(screen.getByRole("button", { name: "Pantalla" }));
  expect(screen.getByLabelText("Identificador de la pantalla")).toHaveValue(
    "clientes_borrador",
  );
});
it("uses an icon-only accessible action to add a JSON:API source", async () => {
  const transport = mockTransport();
  setCrmRuntime({ embedded: true, domainId: "platform", transport });
  mount(<CollectionSourcesPanel onBound={() => {}} />);
  openSourcesTab();
  const addSource = screen.getByRole("button", {
    name: "Nueva fuente externa",
  });
  expect(addSource).toHaveAttribute("aria-label", "Nueva fuente externa");
  expect(addSource).toHaveTextContent("");
});
it("sends source secrets only to backend and never keeps them in the query catalog", async () => {
  const transport = mockTransport();
  setCrmRuntime({ embedded: true, domainId: "platform", transport });
  mount(<CollectionSourcesPanel onBound={() => {}} />);
  openSourcesTab();
  fireEvent.click(screen.getByRole("button", { name: "Nueva fuente externa" }));
  for (const [label, value] of [
    ["Identificador de la fuente", "new_source"],
    ["Nombre de la fuente", "Nueva"],
    ["URL base HTTPS", "https://new.example.test/api"],
    ["Token de acceso (opcional)", "secret-value"],
  ])
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  fireEvent.click(screen.getByRole("button", { name: "Guardar fuente" }));
  await screen.findByText("Fuente guardada. Ya puedes vincular una colección.");
  const call = transport.mock.calls.find(
    ([path, init]) => path === "/api/sources" && init?.method === "POST",
  );
  expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({
    id: "new_source",
    token: "secret-value",
    baseUrl: "https://new.example.test/api",
  });
  fireEvent.click(screen.getByRole("button", { name: "Nueva fuente externa" }));
  expect(screen.getByLabelText("Token de acceso (opcional)")).toHaveValue("");
  expect(screen.queryByText("secret-value")).not.toBeInTheDocument();
});
it("keeps remote writes disabled until explicitly selected and binds explicit fields", async () => {
  const transport = mockTransport();
  setCrmRuntime({ embedded: true, domainId: "platform", transport });
  mount(<CollectionSourcesPanel onBound={() => {}} />);
  fireEvent.change(screen.getByLabelText("Origen"), {
    target: { value: "jsonapi" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Datos" }));
  await screen.findByRole("option", { name: "CRM externo" });
  fireEvent.change(screen.getByLabelText("Fuente"), {
    target: { value: "external" },
  });
  fireEvent.change(
    screen.getByLabelText("Tipo de recurso JSON:API (opcional)"),
    { target: { value: "people" } },
  );
  fireEvent.change(screen.getByLabelText("Campos de la colección (JSON)"), {
    target: {
      value: JSON.stringify({
        name: { type: "Textbox", label: "Nombre" },
        company_id: { type: "Textbox", label: "Empresa" },
      }),
    },
  });
  fireEvent.change(screen.getByLabelText("Relaciones JSON:API (JSON)"), {
    target: { value: JSON.stringify({ company_id: { type: "companies" } }) },
  });
  fireEvent.change(screen.getByLabelText("Recurso remoto"), {
    target: { value: "contacts" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Pantalla" }));
  fireEvent.change(screen.getByLabelText("Identificador de la pantalla"), {
    target: { value: "external_contacts" },
  });
  fireEvent.change(screen.getByLabelText("Nombre de la pantalla"), {
    target: { value: "Contactos" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Datos" }));
  expect(screen.getByRole("checkbox", { name: "Crear" })).not.toBeChecked();
  fireEvent.click(screen.getByRole("checkbox", { name: "Editar" }));
  fireEvent.click(screen.getByRole("button", { name: "Vincular colección" }));
  await waitFor(() =>
    expect(
      transport.mock.calls.some(
        ([path, init]) =>
          path === "/api/collection-bindings" && init?.method === "POST",
      ),
    ).toBe(true),
  );
  const payload = JSON.parse(
    String(
      transport.mock.calls.find(
        ([path, init]) =>
          path === "/api/collection-bindings" && init?.method === "POST",
      )?.[1]?.body,
    ),
  );
  expect(payload).toMatchObject({
    sourceId: "external",
    resource: "contacts",
    resourceType: "people",
    relationships: { company_id: { type: "companies" } },
    fields: {
      name: { type: "Textbox", label: "Nombre" },
      company_id: { type: "Textbox", label: "Empresa" },
    },
    capabilities: { ...caps, update: true },
  });
});
it("analyzes one remote resource and keeps the inferred binding editable", async () => {
  const transport = mockTransport();
  setCrmRuntime({ embedded: true, domainId: "platform", transport });
  mount(<CollectionSourcesPanel onBound={() => {}} />);
  fireEvent.change(screen.getByLabelText("Origen"), {
    target: { value: "jsonapi" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Datos" }));
  await screen.findByRole("option", { name: "CRM externo" });
  fireEvent.change(screen.getByLabelText("Fuente"), {
    target: { value: "external" },
  });
  fireEvent.change(screen.getByLabelText("Recurso remoto"), {
    target: { value: "contacts" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Analizar recurso" }));
  await waitFor(() =>
    expect(
      (
        screen.getByLabelText(
          "Campos de la colección (JSON)",
        ) as HTMLTextAreaElement
      ).value,
    ).toContain('"active"'),
  );
  expect(
    (screen.getByLabelText("Relaciones JSON:API (JSON)") as HTMLTextAreaElement)
      .value,
  ).toContain('"company"');
  expect(
    screen.getByLabelText("Tipo de recurso JSON:API (opcional)"),
  ).toHaveValue("contacts");
  fireEvent.click(screen.getByRole("button", { name: "Pantalla" }));
  expect(screen.getByLabelText("Identificador de la pantalla")).toHaveValue(
    "contacts",
  );
  expect(transport).toHaveBeenCalledWith(
    "/api/sources/external/inspect",
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ resource: "contacts" }),
    }),
  );
});
it("shows backend errors and retains inputs for correction", async () => {
  const transport = mockTransport();
  transport.mockImplementation(async (_path, init) =>
    init?.method === "POST"
      ? Response.json({ error: "La fuente no está permitida" }, { status: 422 })
      : Response.json({ data: [] }),
  );
  setCrmRuntime({ embedded: true, domainId: "platform", transport });
  mount(<CollectionSourcesPanel onBound={() => {}} />);
  openSourcesTab();
  fireEvent.click(screen.getByRole("button", { name: "Nueva fuente externa" }));
  for (const [label, value] of [
    ["Identificador de la fuente", "source"],
    ["Nombre de la fuente", "Fuente"],
    ["URL base HTTPS", "https://example.test"],
  ])
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  fireEvent.click(screen.getByRole("button", { name: "Guardar fuente" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "La fuente no está permitida",
  );
  expect(screen.getByLabelText("Nombre de la fuente")).toHaveValue("Fuente");
});
it("offers layout editing without mutating collection schema", async () => {
  const transport = vi.fn(async () => Response.json({ data: object }));
  const saved = vi.fn();
  setCrmRuntime({ embedded: true, domainId: "platform", transport });
  mount(<CollectionLayoutDesigner object={object} onSaved={saved} />);
  fireEvent.change(
    screen.getByRole("textbox", { name: "Nombre visible de email" }),
    { target: { value: "Correo electrónico" } },
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Subir Correo electrónico" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Guardar diseño" }));
  await waitFor(() => expect(saved).toHaveBeenCalled());
  const payload = JSON.parse(String(transport.mock.calls[0]?.[1]?.body));
  expect(payload.config.fieldOrder).toEqual(["email", "name"]);
  expect(payload.config.fields).toEqual({
    ...object.config.fields,
    email: { ...object.config.fields.email, label: "Correo electrónico" },
  });
});
it("uses server capability metadata before legacy fallback", () => {
  const bound = {
    ...object,
    config: {
      ...object.config,
      studio: {
        collection: {
          sourceId: "remote",
          resource: "contacts",
          kind: "jsonapi",
          capabilities: caps,
        },
      },
    },
  } as CrmObject;
  expect(collectionCapabilities(bound)).toEqual(caps);
  expect(supportsLocalRecordTools(bound)).toBe(false);
  expect(collectionCapabilities(object).create).toBe(true);
  expect(supportsLocalRecordTools(object)).toBe(true);
  const overridden = {
    ...bound,
    config: {
      ...bound.config,
      studio: {
        ...bound.config.studio,
        capabilities: { ...caps, update: true },
      },
    },
  };
  expect(collectionCapabilities(overridden).update).toBe(true);
});

it("omits unsupported query features instead of forwarding UI capability flags", async () => {
  const { dataProvider } = await import("../api");
  const transport = vi.fn(async () =>
    Response.json({
      data: [],
      pageInfo: { hasNextPage: false, hasPreviousPage: false },
    }),
  );
  setCrmRuntime({ embedded: true, domainId: "platform", transport });
  await dataProvider.getList("remote_items", {
    pagination: { page: 1, perPage: 25 },
    sort: { field: "updated_at", order: "DESC" },
    filter: {
      q: "forbidden",
      filters: "forbidden",
      stage: "forbidden",
      __collectionSearch: false,
      __collectionFilter: false,
      __collectionSort: false,
    },
  });
  const url = String(transport.mock.calls[0]?.[0]);
  expect(url).not.toContain("forbidden");
  expect(url).not.toContain("sort=");
  expect(url).not.toContain("order=");
  expect(url).not.toContain("__collection");
});

it("updates a source token explicitly and unbinds only after an inline confirmation", async () => {
  const transport = vi.fn(async (path: string, init?: RequestInit) =>
    Response.json({
      data:
        init?.method === "GET"
          ? path === "/api/sources"
            ? [source]
            : path === "/api/collection-bindings"
              ? [
                  {
                    name: "remote",
                    label: "Pantalla remota",
                    kind: "jsonapi",
                    sourceId: "external",
                    resource: "contacts",
                  },
                ]
              : []
          : {},
    }),
  );
  setCrmRuntime({ embedded: true, domainId: "platform", transport });
  mount(<CollectionSourcesPanel onBound={() => {}} />);
  openSourcesTab();
  fireEvent.click(
    await screen.findByRole("button", { name: "Actualizar acceso" }),
  );
  fireEvent.change(screen.getByLabelText("Token de acceso (opcional)"), {
    target: { value: "new-token" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Guardar fuente" }));
  await waitFor(() =>
    expect(transport).toHaveBeenCalledWith(
      "/api/sources/external",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ label: "CRM externo", token: "new-token" }),
      }),
    ),
  );
  fireEvent.click(screen.getByRole("tab", { name: "Vinculadas" }));
  fireEvent.click(screen.getByRole("button", { name: "Desvincular pantalla" }));
  expect(
    transport.mock.calls.some(([, init]) => init?.method === "DELETE"),
  ).toBe(false);
  fireEvent.click(
    screen.getByRole("button", { name: "Confirmar desvinculación" }),
  );
  await waitFor(() =>
    expect(transport).toHaveBeenCalledWith("/api/collection-bindings/remote", {
      method: "DELETE",
    }),
  );
});
it("identifies HubSpot bindings and hides unsupported operation configuration", async () => {
  const transport = mockTransport([
    {
      name: "hubspot_contacts",
      label: "Contactos HubSpot",
      kind: "crm",
      resource: "contacts",
      sourceId: "",
    } as any,
  ]);
  setCrmRuntime({ embedded: true, domainId: "platform", transport });
  mount(<CollectionSourcesPanel onBound={vi.fn()} />);
  fireEvent.click(screen.getByRole("tab", { name: "Vinculadas" }));
  expect(await screen.findByText("HubSpot · contacts")).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Operaciones", exact: true }),
  ).not.toBeInTheDocument();
});
const pgSource = {
  id: "erp",
  label: "ERP Postgres",
  kind: "postgres",
  host: "pg.internal",
  port: 5432,
  database: "erp",
  username: "reader",
  schema: "public",
  ssl: true,
  hasPassword: true,
};
const pgInspection = {
  resourceType: "orders",
  fields: {
    id: { type: "Textbox", label: "Id", readOnly: true },
    total: { type: "Number", label: "Total", readOnly: true },
  },
  relationships: {},
  primaryKey: ["id"],
};
function mockPgTransport() {
  return vi.fn(async (path: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    if (path === "/api/sources/erp/inspect" && init?.method === "POST") {
      if (!body?.resource)
        return Response.json({
          data: {
            tables: [{ schema: "public", table: "orders", kind: "table" }],
          },
        });
      return Response.json({ data: pgInspection });
    }
    return Response.json({
      data:
        init?.method === "POST"
          ? path === "/api/sources"
            ? pgSource
            : { name: "ordenes_pg", label: "Órdenes" }
          : path === "/api/sources"
            ? [pgSource]
            : path === "/api/collection-catalog"
              ? catalog
              : path === "/api/collection-bindings"
                ? []
                : [],
    });
  });
}
it("creates a Postgres source without ever displaying its password", async () => {
  const transport = mockPgTransport();
  setCrmRuntime({ embedded: true, domainId: "platform", transport });
  mount(<CollectionSourcesPanel onBound={() => {}} />);
  fireEvent.click(screen.getByRole("tab", { name: "Fuentes externas" }));
  fireEvent.click(screen.getByRole("button", { name: "Nueva fuente externa" }));
  fireEvent.change(screen.getByLabelText("Tipo de fuente"), {
    target: { value: "postgres" },
  });
  for (const [label, value] of [
    ["Identificador de la fuente", "erp"],
    ["Nombre de la fuente", "ERP Postgres"],
    ["Host PostgreSQL", "pg.internal"],
    ["Puerto", "5432"],
    ["Base de datos", "erp"],
    ["Usuario", "reader"],
    ["Contraseña (opcional)", "s3cret"],
  ])
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  fireEvent.click(screen.getByRole("button", { name: "Guardar fuente" }));
  await screen.findByText("Fuente guardada. Ya puedes vincular una colección.");
  const call = transport.mock.calls.find(
    ([path, init]) => path === "/api/sources" && init?.method === "POST",
  );
  expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({
    id: "erp",
    kind: "postgres",
    host: "pg.internal",
    port: 5432,
    database: "erp",
    username: "reader",
    password: "s3cret",
  });
  expect(screen.queryByText("s3cret")).not.toBeInTheDocument();
  expect(await screen.findByText("PostgreSQL")).toBeInTheDocument();
});
it("updates a Postgres password explicitly", async () => {
  const transport = mockPgTransport();
  setCrmRuntime({ embedded: true, domainId: "platform", transport });
  mount(<CollectionSourcesPanel onBound={() => {}} />);
  fireEvent.click(screen.getByRole("tab", { name: "Fuentes externas" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "Actualizar acceso" }),
  );
  fireEvent.change(screen.getByLabelText("Contraseña (opcional)"), {
    target: { value: "nueva" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Guardar fuente" }));
  await waitFor(() =>
    expect(transport).toHaveBeenCalledWith(
      "/api/sources/erp",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({
          label: "ERP Postgres",
          writeEnabled: false,
          password: "nueva",
        }),
      }),
    ),
  );
});
it("inspects a Postgres table and binds it read-only without writes", async () => {
  const transport = mockPgTransport();
  setCrmRuntime({ embedded: true, domainId: "platform", transport });
  mount(<CollectionSourcesPanel onBound={() => {}} />);
  fireEvent.change(screen.getByLabelText("Origen"), {
    target: { value: "postgres" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Datos" }));
  await screen.findByRole("option", { name: "ERP Postgres" });
  // Sin tabla, el análisis lista tablas disponibles.
  fireEvent.change(screen.getByLabelText("Fuente"), {
    target: { value: "erp" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Analizar tabla" }));
  await screen.findByText(/Tablas disponibles: orders/);
  fireEvent.change(screen.getByLabelText("Tabla (vacío para listar)"), {
    target: { value: "orders" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Analizar tabla" }));
  await waitFor(() =>
    expect(
      (
        screen.getByLabelText(
          "Campos de la colección (JSON)",
        ) as HTMLTextAreaElement
      ).value,
    ).toContain('"total"'),
  );
  await screen.findByText(/Identificador: id/);
  expect(
    screen.queryByLabelText("Tipo de recurso JSON:API (opcional)"),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByLabelText("Relaciones JSON:API (JSON)"),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("checkbox", { name: "Crear" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Pantalla" }));
  fireEvent.change(screen.getByLabelText("Nombre de la pantalla"), {
    target: { value: "Órdenes" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Vincular colección" }));
  await waitFor(() =>
    expect(
      transport.mock.calls.some(
        ([path, init]) =>
          path === "/api/collection-bindings" && init?.method === "POST",
      ),
    ).toBe(true),
  );
  const payload = JSON.parse(
    String(
      transport.mock.calls.find(
        ([path, init]) =>
          path === "/api/collection-bindings" && init?.method === "POST",
      )?.[1]?.body,
    ),
  );
  expect(payload).toMatchObject({
    sourceId: "erp",
    resource: "orders",
    fields: pgInspection.fields,
  });
  expect(payload.capabilities).toBeUndefined();
  expect(payload.relationships).toBeUndefined();
});
it("labels Postgres bindings and hides their operation configuration", async () => {
  const transport = mockPgTransport();
  transport.mockImplementation(async (path: string, init?: RequestInit) =>
    Response.json({
      data:
        init?.method === "GET"
          ? path === "/api/sources"
            ? [pgSource]
            : path === "/api/collection-bindings"
              ? [
                  {
                    name: "ordenes_pg",
                    label: "Órdenes",
                    kind: "postgres",
                    sourceId: "erp",
                    resource: "orders",
                  },
                ]
              : []
          : {},
    }),
  );
  setCrmRuntime({ embedded: true, domainId: "platform", transport });
  mount(<CollectionSourcesPanel onBound={vi.fn()} />);
  fireEvent.click(screen.getByRole("tab", { name: "Vinculadas" }));
  expect(await screen.findByText("PostgreSQL")).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Operaciones", exact: true }),
  ).not.toBeInTheDocument();
});

it("offers four database engines with their connection defaults", async () => {
  const transport = mockTransport();
  setCrmRuntime({ embedded: true, domainId: "platform", transport });
  mount(<CollectionSourcesPanel />);
  openSourcesTab();
  fireEvent.click(screen.getByRole("button", { name: /Nueva fuente/ }));
  const kind = screen.getByLabelText("Tipo de fuente");
  for (const [value, port] of [
    ["mysql", "3306"],
    ["mssql", "1433"],
    ["mongodb", "27017"],
    ["postgres", "5432"],
  ]) {
    fireEvent.change(kind, { target: { value } });
    expect(screen.getByLabelText("Puerto")).toHaveValue(port);
  }
});

it("splits binding into Origen, Datos and Pantalla steps", async () => {
  const transport = mockTransport();
  setCrmRuntime({ embedded: true, domainId: "platform", transport });
  mount(<CollectionSourcesPanel onBound={() => {}} />);
  await screen.findByRole("option", {
    name: "Clientes originales · customer-portfolio",
  });
  for (const name of ["Origen", "Datos", "Pantalla"]) {
    expect(screen.getByRole("button", { name })).toBeInTheDocument();
  }
  expect(
    screen.queryByLabelText("Nombre de la pantalla"),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Datos" }));
  expect(
    screen.getByText(
      "La pantalla respetará las operaciones disponibles en esta colección.",
    ),
  ).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Pantalla" }));
  expect(screen.getByLabelText("Nombre de la pantalla")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Origen" }));
  expect(screen.getByLabelText("Colección")).toBeVisible();
});

it("reveals secret handling guidance through a tooltip instead of inline text", async () => {
  const transport = mockTransport();
  setCrmRuntime({ embedded: true, domainId: "platform", transport });
  mount(<CollectionSourcesPanel onBound={() => {}} />);
  openSourcesTab();
  fireEvent.click(screen.getByRole("button", { name: "Nueva fuente externa" }));
  const help = screen.getByRole("button", {
    name: "Token de acceso (opcional) (Ayuda)",
  });
  fireEvent.focus(help);
  expect(
    await screen.findByText(
      "El token se guarda cifrado en el servidor y no se devuelve en el catálogo.",
    ),
  ).toBeVisible();
});

it("shows linked collections in their own tab with a shortcut back", async () => {
  const transport = mockTransport();
  setCrmRuntime({ embedded: true, domainId: "platform", transport });
  mount(<CollectionSourcesPanel onBound={() => {}} />);
  fireEvent.click(screen.getByRole("tab", { name: "Vinculadas" }));
  expect(
    await screen.findByText(
      "Aún no hay colecciones vinculadas en este dominio.",
    ),
  ).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Vincular colección" }));
  expect(screen.getByLabelText("Origen")).toBeVisible();
});

it("embeds integrations as its own tab and honors the initial section", async () => {
  const transport = mockTransport();
  setCrmRuntime({ embedded: true, domainId: "platform", transport });
  mount(
    <CollectionSourcesPanel onBound={() => {}} initialSection="integrations" />,
  );
  expect(
    await screen.findByRole("heading", { name: "De API a herramienta." }),
  ).toBeVisible();
  expect(screen.getByRole("tab", { name: "Integraciones" })).toHaveAttribute(
    "data-state",
    "active",
  );
});
