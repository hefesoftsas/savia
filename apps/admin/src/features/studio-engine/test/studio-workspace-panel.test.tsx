// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { render } from "./locale-test-render";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import StudioWorkspacePanel from "../studio-workspace-panel";
const catalog = {
  connected: true,
  accountLabel: "Equipo comercial",
  objects: [
    {
      name: "hubspot_contacts",
      label: "Contactos",
      resource: "contacts",
      available: true,
    },
    {
      name: "hubspot_quotes",
      label: "Cotizaciones",
      resource: "quotes",
      available: false,
      reason: "Falta permiso de lectura",
    },
  ],
};
const installedCatalog = {
  ...catalog,
  objects: [{ ...catalog.objects[0]!, installed: true }, catalog.objects[1]!],
};
function mount(request: any, onInstalled = vi.fn(), scope = "sales") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <StudioWorkspacePanel
        scope={scope}
        request={request}
        onInstalled={onInstalled}
      />
    </QueryClientProvider>,
  );
  return { client, onInstalled, ...view };
}
afterEach(cleanup);
it("shows availability and installs before opening a screen", async () => {
  const request = vi.fn(async (path: string) =>
    path.endsWith("/install")
      ? { objects: [{ name: "hubspot_contacts", label: "Contactos" }] }
      : catalog,
  );
  const { client, onInstalled } = mount(request);
  const invalidate = vi.spyOn(client, "invalidateQueries");
  expect(
    await screen.findByText(
      "Equipo comercial · 1 por instalar · 2 en catálogo",
    ),
  ).toBeVisible();
  expect(screen.getByText("Falta permiso de lectura")).toBeVisible();
  const install = screen.getByRole("button", {
    name: "Instalar seleccionadas (0)",
  });
  expect(install).toBeDisabled();
  fireEvent.click(
    screen.getByRole("checkbox", { name: "Seleccionar Contactos" }),
  );
  expect(
    screen.getByRole("button", { name: "Instalar seleccionadas (1)" }),
  ).toBeEnabled();
  fireEvent.click(
    screen.getByRole("button", {
      name: "Instalar seleccionadas (1)",
    }),
  );
  await waitFor(() =>
    expect(onInstalled).toHaveBeenCalledWith({
      name: "hubspot_contacts",
      label: "Contactos",
    }),
  );
  expect(request).toHaveBeenCalledWith("/crm-workspace/install", "POST", {
    resources: ["contacts"],
  });
  expect(invalidate).toHaveBeenCalled();
});
it("selects all installable screens and excludes unavailable or already installed entries", async () => {
  const selectionCatalog = {
    ...catalog,
    objects: [
      { ...catalog.objects[0]!, available: true },
      {
        name: "hubspot_companies",
        label: "Empresas",
        resource: "companies",
        available: true,
      },
      { ...catalog.objects[1]!, available: false },
      {
        name: "hubspot_deals",
        label: "Negocios",
        resource: "deals",
        available: true,
        installed: true,
      },
    ],
  };
  const request = vi.fn(async (path: string) =>
    path.endsWith("/install")
      ? {
          objects: [
            { name: "hubspot_contacts", label: "Contactos" },
            { name: "hubspot_companies", label: "Empresas" },
          ],
        }
      : selectionCatalog,
  );
  mount(request);
  await screen.findByText("Equipo comercial · 2 por instalar · 4 en catálogo");
  expect(screen.getByText("Instalada")).toBeInTheDocument();
  const installed = screen.getByRole("checkbox", {
    name: "Seleccionar Negocios",
  });
  const unavailable = screen.getByRole("checkbox", {
    name: "Seleccionar Cotizaciones",
  });
  expect(installed).toBeDisabled();
  expect(unavailable).toBeDisabled();
  fireEvent.click(
    screen.getByRole("button", { name: "Seleccionar todas las disponibles" }),
  );
  expect(
    screen.getByRole("checkbox", { name: "Seleccionar Contactos" }),
  ).toBeChecked();
  expect(
    screen.getByRole("checkbox", { name: "Seleccionar Empresas" }),
  ).toBeChecked();
  expect(
    screen.getByRole("button", { name: "Instalar seleccionadas (2)" }),
  ).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Limpiar selección" }));
  expect(
    screen.getByRole("button", { name: "Instalar seleccionadas (0)" }),
  ).toBeDisabled();
  fireEvent.click(
    screen.getByRole("button", { name: "Seleccionar todas las disponibles" }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Instalar seleccionadas (2)" }),
  );
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith("/crm-workspace/install", "POST", {
      resources: ["contacts", "companies"],
    }),
  );
});
it("hides the panel without an active connection", async () => {
  const request = vi.fn(async () => ({ connected: false, objects: [] }));
  mount(request);
  await waitFor(() => expect(request).toHaveBeenCalled());
  expect(
    screen.queryByRole("heading", { name: "CRM conectado · HubSpot" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByText(/No hay una conexión HubSpot activa/),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", {
      name: "Instalar seleccionadas (0)",
    }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Actualizar disponibilidad" }),
  ).not.toBeInTheDocument();
});
it("preserves the chosen screens after failure and retries with the same explicit selection", async () => {
  let installCalls = 0;
  const request = vi.fn(async (path: string) => {
    if (path.endsWith("/install")) {
      installCalls += 1;
      if (installCalls === 1)
        throw new Error("La conexión ha caducado. Vuelve a conectar HubSpot.");
      return {
        objects: [{ name: "hubspot_contacts", label: "Contactos" }],
      };
    }
    return catalog;
  });
  const { onInstalled } = mount(request);
  await screen.findByText("Contactos");
  const contacts = screen.getByRole("checkbox", {
    name: "Seleccionar Contactos",
  });
  fireEvent.click(contacts);
  fireEvent.click(
    screen.getByRole("button", {
      name: "Instalar seleccionadas (1)",
    }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "La conexión ha caducado",
  );
  expect(onInstalled).not.toHaveBeenCalled();
  expect(contacts).toBeChecked();
  expect(request).toHaveBeenNthCalledWith(2, "/crm-workspace/install", "POST", {
    resources: ["contacts"],
  });
  fireEvent.click(
    screen.getByRole("button", {
      name: "Instalar seleccionadas (1)",
    }),
  );
  await waitFor(() => expect(onInstalled).toHaveBeenCalled());
  expect(request).toHaveBeenNthCalledWith(3, "/crm-workspace/install", "POST", {
    resources: ["contacts"],
  });
  expect(screen.queryByText(/pantallas de HubSpot listas/)).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Instalar seleccionadas (0)" }),
  ).toBeDisabled();
});

it("confirms HubSpot uninstall, preserves remote records, and refreshes only object and binding queries", async () => {
  const request = vi.fn(async (path: string) =>
    path.startsWith("/collection-bindings/") ? undefined : installedCatalog,
  );
  const { client } = mount(request);
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const cancel = vi.spyOn(client, "cancelQueries");
  await screen.findByText("Instalada");
  fireEvent.click(screen.getByRole("button", { name: "Desinstalar" }));
  expect(
    screen.getByText("Los registros de HubSpot se conservarán."),
  ).toBeInTheDocument();
  expect(request).not.toHaveBeenCalledWith(
    "/collection-bindings/hubspot_contacts",
    "DELETE",
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Confirmar desinstalación" }),
  );
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith(
      "/collection-bindings/hubspot_contacts",
      "DELETE",
    ),
  );
  await waitFor(() =>
    expect(
      screen.getByRole("checkbox", { name: "Seleccionar Contactos" }),
    ).toBeEnabled(),
  );
  expect(
    client.getQueryData<any>(["crm-workspace", "sales"])?.objects[0]?.installed,
  ).toBe(false);
  expect(cancel).toHaveBeenCalledWith({
    queryKey: ["crm-workspace", "sales"],
    exact: true,
  });
  await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(2));
  expect(invalidate.mock.calls.map(([filters]) => filters?.queryKey)).toEqual(
    expect.arrayContaining([
      ["/api/objects"],
      ["collection-bindings", "sales"],
    ]),
  );
  expect(invalidate.mock.calls.every(([filters]) => filters?.queryKey)).toBe(
    true,
  );
});

it("keeps uninstall confirmation after a failure so the user can retry", async () => {
  let deleteCalls = 0;
  const request = vi.fn(async (path: string) => {
    if (path.startsWith("/collection-bindings/")) {
      deleteCalls += 1;
      if (deleteCalls === 1) throw new Error("Binding is in use");
      return undefined;
    }
    return installedCatalog;
  });
  mount(request);
  await screen.findByText("Instalada");
  fireEvent.click(screen.getByRole("button", { name: "Desinstalar" }));
  fireEvent.click(
    screen.getByRole("button", { name: "Confirmar desinstalación" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Binding is in use",
  );
  expect(
    screen.getByRole("group", {
      name: "Confirmar desinstalación de Contactos",
    }),
  ).toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: "Confirmar desinstalación" }),
  );
  await waitFor(() =>
    expect(
      screen.getByRole("checkbox", { name: "Seleccionar Contactos" }),
    ).toBeEnabled(),
  );
  expect(deleteCalls).toBe(2);
});

it("uses provider-qualified discovery and installation with an isolated cache for Salesforce", async () => {
  const salesforce = {
    provider: "salesforce",
    connected: true,
    accountLabel: "Acme Salesforce",
    objects: [
      {
        name: "salesforce_contacts",
        label: "Contactos",
        resource: "contacts",
        available: true,
        installed: false,
        capabilities: {
          list: true,
          read: true,
          create: true,
          update: true,
          delete: false,
        },
      },
    ],
  };
  const request = vi.fn(async (path: string) =>
    path.endsWith("/install")
      ? { objects: [{ name: "salesforce_contacts", label: "Contactos" }] }
      : salesforce,
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <StudioWorkspacePanel
        scope="sales"
        provider="salesforce"
        request={request}
        onInstalled={vi.fn()}
      />
    </QueryClientProvider>,
  );
  await screen.findByText("Acme Salesforce · 1 por instalar · 1 en catálogo");
  expect(request).toHaveBeenCalledWith("/crm-workspace/salesforce");
  expect(screen.getByText("CRM conectado · Salesforce")).toBeVisible();
  fireEvent.click(
    screen.getByRole("checkbox", { name: "Seleccionar Contactos" }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Instalar seleccionadas (1)" }),
  );
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith(
      "/crm-workspace/salesforce/install",
      "POST",
      {
        resources: ["contacts"],
      },
    ),
  );
  expect(
    client.getQueryData(["crm-workspace", "salesforce", "sales"]),
  ).toBeDefined();
  expect(client.getQueryData(["crm-workspace", "sales"])).toBeUndefined();
  view.unmount();
});

it("keeps provider workspace catalogs in separate query cache entries", async () => {
  const providers = ["salesforce", "zoho", "pipedrive"] as const;
  const request = vi.fn(async (path: string) => {
    const provider = path.split("/").at(-1) ?? "hubspot";
    return { provider, connected: false, objects: [] };
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      {providers.map((provider) => (
        <StudioWorkspacePanel
          key={provider}
          scope="sales"
          provider={provider}
          request={request}
          onInstalled={vi.fn()}
        />
      ))}
    </QueryClientProvider>,
  );
  await waitFor(() => expect(request).toHaveBeenCalledTimes(providers.length));
  for (const provider of providers) {
    expect(request).toHaveBeenCalledWith(`/crm-workspace/${provider}`);
    expect(client.getQueryData(["crm-workspace", provider, "sales"])).toEqual({
      provider,
      connected: false,
      objects: [],
    });
  }
  expect(client.getQueryData(["crm-workspace", "sales"])).toBeUndefined();
});

it("supports canceling uninstall and reinstalling the screen later", async () => {
  const calls: Array<[string, string | undefined, unknown]> = [];
  const request = vi.fn(
    async (path: string, method?: string, body?: unknown) => {
      calls.push([path, method, body]);
      if (path.startsWith("/collection-bindings/")) return undefined;
      if (path.endsWith("/install"))
        return { objects: [{ name: "hubspot_contacts", label: "Contactos" }] };
      return installedCatalog;
    },
  );
  mount(request);
  await screen.findByText("Instalada");
  fireEvent.click(screen.getByRole("button", { name: "Desinstalar" }));
  fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
  expect(calls.some(([path]) => path.startsWith("/collection-bindings/"))).toBe(
    false,
  );
  expect(screen.getByText("Instalada")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Desinstalar" }));
  fireEvent.click(
    screen.getByRole("button", { name: "Confirmar desinstalación" }),
  );
  const contacts = await screen.findByRole("checkbox", {
    name: "Seleccionar Contactos",
  });
  expect(contacts).toBeEnabled();
  fireEvent.click(contacts);
  fireEvent.click(
    screen.getByRole("button", { name: "Instalar seleccionadas (1)" }),
  );
  await waitFor(() =>
    expect(calls).toContainEqual([
      "/crm-workspace/install",
      "POST",
      { resources: ["contacts"] },
    ]),
  );
  expect(screen.getByText("Instalada")).toBeInTheDocument();
});
it("allows retry after a catalog error", async () => {
  mount(
    vi
      .fn()
      .mockRejectedValueOnce(new Error("Sin acceso"))
      .mockResolvedValue(catalog),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent("Sin acceso");
  fireEvent.click(
    screen.getByRole("button", { name: "Actualizar disponibilidad" }),
  );
  expect(await screen.findByText("Contactos")).toBeVisible();
});

it("allows adding an available screen while an installed screen stays disabled", async () => {
  const connectedCatalog = {
    ...catalog,
    objects: [
      { ...catalog.objects[0]!, installed: true },
      {
        ...catalog.objects[1]!,
        available: true,
        reason: undefined,
      },
    ],
  };
  const request = vi.fn(async (path: string) =>
    path.endsWith("/install")
      ? { objects: [{ name: "hubspot_quotes", label: "Cotizaciones" }] }
      : connectedCatalog,
  );
  mount(request);
  await screen.findByText("Equipo comercial · 1 por instalar · 2 en catálogo");
  expect(screen.getByText("Instalada")).toBeInTheDocument();
  const contacts = screen.getByRole("checkbox", {
    name: "Seleccionar Contactos",
  });
  expect(contacts).toBeDisabled();
  fireEvent.click(
    screen.getByRole("checkbox", { name: "Seleccionar Cotizaciones" }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Instalar seleccionadas (1)" }),
  );
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith("/crm-workspace/install", "POST", {
      resources: ["quotes"],
    }),
  );
});

it("drops a selected resource when it becomes unavailable after refresh", async () => {
  let catalogCalls = 0;
  const request = vi.fn(async (path: string) => {
    if (path.endsWith("/install"))
      return { objects: [{ name: "hubspot_contacts", label: "Contactos" }] };
    catalogCalls += 1;
    return catalogCalls === 1
      ? catalog
      : {
          ...catalog,
          objects: [
            { ...catalog.objects[0]!, available: false },
            catalog.objects[1]!,
          ],
        };
  });
  mount(request);
  await screen.findByText("Contactos");
  fireEvent.click(
    screen.getByRole("checkbox", { name: "Seleccionar Contactos" }),
  );
  expect(
    screen.getByRole("button", { name: "Instalar seleccionadas (1)" }),
  ).toBeEnabled();
  fireEvent.click(
    screen.getByRole("button", { name: "Actualizar disponibilidad" }),
  );
  await waitFor(() =>
    expect(
      screen.getByRole("checkbox", { name: "Seleccionar Contactos" }),
    ).toBeDisabled(),
  );
  expect(
    screen.getByRole("checkbox", { name: "Seleccionar Contactos" }),
  ).not.toBeChecked();
  expect(
    screen.getByRole("button", { name: "Instalar seleccionadas (0)" }),
  ).toBeDisabled();
});

it("clears the selection when the tenant scope changes", async () => {
  const request = vi.fn(async () => catalog);
  const { client, onInstalled, rerender } = mount(request);
  await screen.findByText("Contactos");
  fireEvent.click(
    screen.getByRole("checkbox", { name: "Seleccionar Contactos" }),
  );
  expect(
    screen.getByRole("button", { name: "Instalar seleccionadas (1)" }),
  ).toBeEnabled();
  rerender(
    <QueryClientProvider client={client}>
      <StudioWorkspacePanel
        scope="marketing"
        request={request}
        onInstalled={onInstalled}
      />
    </QueryClientProvider>,
  );
  await screen.findByText("Contactos");
  expect(
    screen.getByRole("checkbox", { name: "Seleccionar Contactos" }),
  ).not.toBeChecked();
  expect(
    screen.getByRole("button", { name: "Instalar seleccionadas (0)" }),
  ).toBeDisabled();
});
