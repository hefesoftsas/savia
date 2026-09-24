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
function mount(request: any, onInstalled = vi.fn()) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <StudioWorkspacePanel
        scope="sales"
        request={request}
        onInstalled={onInstalled}
      />
    </QueryClientProvider>,
  );
  return { client, onInstalled };
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
    await screen.findByText("Equipo comercial · 1 de 2 pantallas disponibles"),
  ).toBeVisible();
  expect(screen.getByText("Falta permiso de lectura")).toBeVisible();
  fireEvent.click(
    screen.getByRole("button", {
      name: "Instalar todas las pantallas disponibles",
    }),
  );
  await waitFor(() =>
    expect(onInstalled).toHaveBeenCalledWith({
      name: "hubspot_contacts",
      label: "Contactos",
    }),
  );
  expect(request).toHaveBeenCalledWith("/crm-workspace/install", "POST", {});
  expect(invalidate).toHaveBeenCalled();
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
      name: "Instalar todas las pantallas disponibles",
    }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Actualizar disponibilidad" }),
  ).not.toBeInTheDocument();
});
it("reports failed installation without navigating or claiming success", async () => {
  const request = vi.fn(async (path: string) => {
    if (path.endsWith("/install"))
      throw new Error("La conexión ha caducado. Vuelve a conectar HubSpot.");
    return catalog;
  });
  const { onInstalled } = mount(request);
  await screen.findByText("Contactos");
  fireEvent.click(
    screen.getByRole("button", {
      name: "Instalar todas las pantallas disponibles",
    }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "La conexión ha caducado",
  );
  expect(onInstalled).not.toHaveBeenCalled();
  expect(
    screen.queryByText(/pantallas de HubSpot listas/),
  ).not.toBeInTheDocument();
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
