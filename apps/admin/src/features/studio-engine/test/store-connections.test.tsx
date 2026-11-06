// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { render } from "./locale-test-render";
import { StoreConnections } from "../store-connections";
import { api } from "../api";

vi.mock("../api", () => ({ api: vi.fn(), apiFetch: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

const connectors = [
  {
    id: "demo",
    label: "API demo",
    fields: [
      {
        name: "baseUrl",
        type: "string" as const,
        required: true,
        secret: false,
      },
      { name: "apiKey", type: "string" as const, required: true, secret: true },
      {
        name: "retries",
        type: "number" as const,
        required: false,
        secret: false,
      },
    ],
  },
];

it("lista el conector y guarda la conexión con sus valores", async () => {
  vi.mocked(api).mockImplementation(async (path, method, body) => {
    if (path === "/extensions/custom.echo/connections") return { data: [] };
    if (
      path === "/extensions/custom.echo/connections/demo" &&
      method === "PUT"
    ) {
      expect(body).toEqual({
        connectorId: "demo",
        values: { baseUrl: "api.ejemplo.test", apiKey: "K", retries: 2 },
      });
      return undefined;
    }
    throw new Error(`Unexpected API request: ${path}`);
  });
  render(
    <StoreConnections extensionId="custom.echo" connectors={connectors} />,
  );

  expect(
    await screen.findByText("Sin conexiones configuradas."),
  ).toBeInTheDocument();

  fireEvent.change(screen.getByLabelText(/baseUrl/), {
    target: { value: "api.ejemplo.test" },
  });
  const secret = screen.getByLabelText(/apiKey/) as HTMLInputElement;
  expect(secret.type).toBe("password");
  fireEvent.change(secret, { target: { value: "K" } });
  fireEvent.change(screen.getByLabelText(/retries/), {
    target: { value: "2" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Configurar conexión de API demo" }),
  );

  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(
      "/extensions/custom.echo/connections/demo",
      "PUT",
      {
        connectorId: "demo",
        values: { baseUrl: "api.ejemplo.test", apiKey: "K", retries: 2 },
      },
    ),
  );
});

it("ofrece eliminar una conexión configurada", async () => {
  vi.mocked(api).mockImplementation(async (path, method) => {
    if (path === "/extensions/custom.echo/connections")
      return {
        data: [{ connectionId: "demo", connectorId: "demo", configured: true }],
      };
    if (
      path === "/extensions/custom.echo/connections/demo" &&
      method === "DELETE"
    )
      return undefined;
    throw new Error(`Unexpected API request: ${path}`);
  });
  render(
    <StoreConnections extensionId="custom.echo" connectors={connectors} />,
  );

  fireEvent.click(
    await screen.findByRole("button", { name: "Eliminar API demo" }),
  );
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(
      "/extensions/custom.echo/connections/demo",
      "DELETE",
    ),
  );
});
