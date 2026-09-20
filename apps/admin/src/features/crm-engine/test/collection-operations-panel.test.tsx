// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { afterEach, it, expect, vi } from "vitest";
import { screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { render } from "./studio-test-render";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Panel from "../collection-operations-panel";
import { api } from "../api";
import { endpointSchema } from "@savia/crm-shared/collection-operations";
vi.mock("../api", () => ({ api: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
it("preloads endpoint configuration and saves an explicitly disabled action with its version", async () => {
  const create = endpointSchema.parse({
    path: "clients",
    method: "POST",
    format: "json",
  });
  const operations = {
    list: null,
    read: null,
    create,
    update: null,
    delete: null,
  };
  vi.mocked(api).mockResolvedValue({
    data: {
      version: 7,
      kind: "jsonapi",
      resource: "clients",
      fields: [],
      operations,
      candidates: [],
    },
  });
  const close = vi.fn();
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <Panel name="clients" label="Clientes" onClose={close} />
    </QueryClientProvider>,
  );
  expect(await screen.findByLabelText("Ruta · Crear")).toHaveValue("clients");
  fireEvent.change(screen.getByLabelText("Crear", { selector: "select" }), {
    target: { value: "" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Guardar operaciones" }));
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(
      "/collection-bindings/clients/operations",
      "PUT",
      { version: 7, operations: { ...operations, create: null } },
    ),
  );
  await waitFor(() => expect(close).toHaveBeenCalled());
});

it("allows entering a registered internal endpoint manually", async () => {
  const list = endpointSchema.parse({
    path: "/v1/geographic-catalog/countries",
    method: "GET",
    format: "domain",
  });
  vi.mocked(api).mockResolvedValue({
    data: {
      version: 1,
      kind: "domain",
      resource: "countries",
      fields: [],
      operations: {
        list,
        read: null,
        create: null,
        update: null,
        delete: null,
      },
      candidates: [],
    },
  });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Panel name="countries" label="Países" onClose={() => {}} />
    </QueryClientProvider>,
  );
  const create = await screen.findByLabelText("Crear", { selector: "select" });
  fireEvent.change(create, { target: { value: "manual" } });
  const route = screen.getByLabelText("Ruta · Crear");
  expect(route).not.toHaveAttribute("readonly");
  fireEvent.change(route, {
    target: { value: "/v1/geographic-catalog/commands/register-country" },
  });
  expect(screen.getByLabelText("Método · Crear")).not.toBeDisabled();
  expect(route).toHaveValue("/v1/geographic-catalog/commands/register-country");
});
