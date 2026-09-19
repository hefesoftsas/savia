// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Designer from "../designer";
import { makeConfig, type CrmObject } from "@savia/crm-shared/metadata";

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/objects")) {
        return new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("/api/settings/geocoding")) {
        return new Response(
          JSON.stringify({
            geoapifyConfigured: false,
            geoapifyStored: false,
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      }
      return new Response(JSON.stringify({ error: "unexpected" }), {
        status: 404,
      });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("offers contact field types from the designer palette", async () => {
  const object: CrmObject = {
    name: "contacts",
    label: "Contactos",
    description: "",
    config: makeConfig({ name: { type: "Textbox", label: "Nombre" } }),
  };
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Designer object={object} onSaved={vi.fn()} />
    </QueryClientProvider>,
  );

  for (const label of ["Correo", "Teléfono", "Página web", "Dirección"]) {
    fireEvent.click(screen.getByRole("button", { name: label }));
    expect(screen.getAllByText(label).length).toBeGreaterThan(1);
  }

  fireEvent.click(screen.getByRole("button", { name: "Dirección" }));
  expect(
    screen.getByRole("checkbox", { name: "Autocompletar con mapas" }),
  ).toBeTruthy();

  fireEvent.click(
    screen.getByRole("checkbox", { name: "Autocompletar con mapas" }),
  );
  fireEvent.change(screen.getByDisplayValue("Photon (OpenStreetMap, gratis)"), {
    target: { value: "geoapify" },
  });
  fireEvent.focus(
    screen.getByRole("button", { name: "Ayuda sobre proveedor" }),
  );
  expect(
    await screen.findByRole("link", { name: "Claves y servicios" }),
  ).toBeVisible();
});

it("adds dedicated date-time and time fields from the palette", () => {
  const object: CrmObject = {
    name: "appointments",
    label: "Appointments",
    description: "",
    config: makeConfig({ name: { type: "Textbox", label: "Name" } }),
  };
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Designer object={object} onSaved={vi.fn()} />
    </QueryClientProvider>,
  );
  for (const label of ["Date and time", "Time"]) {
    fireEvent.click(screen.getByRole("button", { name: label, exact: true }));
    expect(screen.getAllByText(label).length).toBeGreaterThan(1);
  }
});
