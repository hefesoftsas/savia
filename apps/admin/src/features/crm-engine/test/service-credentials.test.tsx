// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ServiceCredentials from "../service-credentials";

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
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
      if (url.includes("/api/integrations")) {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: "1",
                name: "Proveedor demo",
                connection: { mode: "external", authType: "bearer" },
                hasSecret: true,
              },
            ],
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

it("lists credential sections for maps and integrations", async () => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ServiceCredentials
        selected="contacts"
        domainTools={false}
        onNavigate={vi.fn()}
      />
    </QueryClientProvider>,
  );

  expect(screen.getByRole("heading", { name: "Claves y servicios" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Mapas y direcciones" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Integraciones OpenAPI" })).toBeTruthy();
  expect(screen.getByRole("button", { name: /Guardar clave/i })).toBeTruthy();
  expect(await screen.findByText("Proveedor demo")).toBeTruthy();
});
