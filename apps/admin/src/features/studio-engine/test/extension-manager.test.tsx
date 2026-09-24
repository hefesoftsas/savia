// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { render } from "./locale-test-render";
import userEvent from "@testing-library/user-event";
import ExtensionManager from "../extension-manager";
import { api } from "../api";

vi.mock("../api", () => ({ api: vi.fn() }));
vi.mock("../extension-connections", () => ({
  ExtensionConnections: ({ label }: { label?: string }) => (
    <section aria-label={`Conexiones de ${label}`}>Conexiones</section>
  ),
}));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

const manifest = {
  format: "savia.extension" as const,
  formatVersion: 1 as const,
  id: "insurance.portfolio-dashboard",
  version: "1.0.0",
  label: "Cartera de pólizas",
  description: "Resumen de pólizas para este espacio.",
  requires: [],
  apiVersion: 1 as const,
};
const quotesManifest = {
  ...manifest,
  id: "insurance.quotes",
  label: "Cotizaciones de seguros",
  description: "Conecta proveedores de seguros para solicitar cotizaciones.",
};

it("hides extension detail until it is requested", async () => {
  const user = userEvent.setup();
  vi.mocked(api).mockResolvedValue({
    data: [{ manifest: quotesManifest, builtIn: true, installed: null }],
  });
  render(<ExtensionManager onChanged={() => undefined} />);

  expect(
    await screen.findByText("Cotizaciones de seguros"),
  ).toBeInTheDocument();
  expect(screen.getByRole("list").firstElementChild).toHaveAttribute(
    "role",
    "listitem",
  );
  expect(
    screen.queryByText(quotesManifest.description),
  ).not.toBeInTheDocument();
  await user.hover(
    screen.getByRole("button", {
      name: "Más información sobre Cotizaciones de seguros",
    }),
  );
  expect(await screen.findByRole("tooltip")).toHaveTextContent(
    quotesManifest.description,
  );
});

it("installs the dashboard without duplicating its Pólizas screen", async () => {
  let installed: { enabled: boolean; version: string } | null = null;
  vi.mocked(api).mockImplementation(async (path, method) => {
    if (path === "/extensions")
      return { data: [{ manifest, builtIn: false, installed }] };
    if (path === `/extensions/${manifest.id}/install` && method === "POST") {
      installed = { enabled: true, version: "1.0.0" };
      return { data: { id: manifest.id, ...installed } };
    }
    throw new Error(`Unexpected API request: ${path}`);
  });
  const changed = vi.fn();
  render(<ExtensionManager onChanged={changed} />);

  expect(await screen.findByText("Cartera de pólizas")).toBeInTheDocument();
  expect(screen.getByText("Disponible")).toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: "Instalar Cartera de pólizas" }),
  );
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(
      `/extensions/${manifest.id}/install`,
      "POST",
    ),
  );
  await waitFor(() => expect(changed).toHaveBeenCalledOnce());
  expect(
    screen.queryByRole("button", { name: /Abrir panel/ }),
  ).not.toBeInTheDocument();
  expect(api).not.toHaveBeenCalledWith(`/extensions/${manifest.id}/summary`);
});

it("deactivates an installed extension", async () => {
  const installed = { enabled: true, version: "1.0.0" };
  vi.mocked(api).mockImplementation(async (path, method, body) => {
    if (path === "/extensions")
      return { data: [{ manifest, builtIn: false, installed }] };
    if (path === `/extensions/${manifest.id}` && method === "PATCH") {
      expect(body).toEqual({ enabled: false });
      return { data: { id: manifest.id, enabled: false } };
    }
    throw new Error(`Unexpected API request: ${path}`);
  });
  render(<ExtensionManager onChanged={() => undefined} />);

  fireEvent.click(
    await screen.findByRole("button", {
      name: "Desactivar Cartera de pólizas",
    }),
  );
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(`/extensions/${manifest.id}`, "PATCH", {
      enabled: false,
    }),
  );
});

it("repairs an active dashboard installation without deactivating it", async () => {
  const installed = { enabled: true, version: "1.0.0" };
  vi.mocked(api).mockImplementation(async (path, method) => {
    if (path === "/extensions")
      return { data: [{ manifest, builtIn: false, installed }] };
    if (path === `/extensions/${manifest.id}/install` && method === "POST")
      return { data: { id: manifest.id, ...installed } };
    throw new Error(`Unexpected API request: ${path}`);
  });
  const changed = vi.fn();
  render(<ExtensionManager onChanged={changed} />);

  fireEvent.click(
    await screen.findByRole("button", {
      name: "Reparar instalación Cartera de pólizas",
    }),
  );

  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(
      `/extensions/${manifest.id}/install`,
      "POST",
    ),
  );
  await waitFor(() => expect(changed).toHaveBeenCalledOnce());
  expect(screen.getByText("Activa")).toBeInTheDocument();
});
