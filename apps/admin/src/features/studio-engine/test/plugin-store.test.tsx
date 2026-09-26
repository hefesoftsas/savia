// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { render } from "./locale-test-render";
import PluginStoreManager from "../plugin-store";
import { api } from "../api";

vi.mock("../api", () => ({ api: vi.fn(), apiFetch: vi.fn() }));
vi.mock("../custom-plugin-frame", () => ({
  CustomPluginFrame: ({ title }: { title: string }) => (
    <div data-testid="plugin-frame">{title}</div>
  ),
}));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

const item = {
  manifest: {
    id: "custom.demo",
    version: "1.0.0",
    label: "Demo",
    description: "Plugin de demostración.",
    requires: [],
  },
  version: "1.0.0",
  sha256: "abc123",
  sizeBytes: 1024,
  createdAt: "2026-01-01",
  installed: null,
};

it("lista, instala y muestra un plugin del store", async () => {
  let installed: { enabled: boolean; version: string } | null = null;
  vi.mocked(api).mockImplementation(async (path, method) => {
    if (path === "/plugin-store") return { data: [{ ...item, installed }] };
    if (path === "/extensions/custom.demo/install" && method === "POST") {
      installed = { enabled: true, version: "1.0.0" };
      return { data: { id: "custom.demo", ...installed } };
    }
    throw new Error(`Unexpected API request: ${path}`);
  });
  const changed = vi.fn();
  render(<PluginStoreManager onChanged={changed} />);

  expect(await screen.findByText("Demo")).toBeInTheDocument();
  expect(screen.getByText("Disponible")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Instalar Demo" }));
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith("/extensions/custom.demo/install", "POST"),
  );
  await waitFor(() => expect(changed).toHaveBeenCalled());
});

it("sube un zip y desactiva un plugin activo", async () => {
  const installed = { enabled: true, version: "1.0.0" };
  vi.mocked(api).mockImplementation(async (path, method, body) => {
    if (path === "/plugin-store") return { data: [{ ...item, installed }] };
    if (path === "/plugin-store/upload" && method === "POST") {
      expect(body).toBeInstanceOf(FormData);
      return { data: { id: "custom.demo", version: "1.0.0" } };
    }
    if (path === "/extensions/custom.demo" && method === "PATCH") {
      expect(body).toEqual({ enabled: false });
      return { data: { id: "custom.demo", enabled: false } };
    }
    throw new Error(`Unexpected API request: ${path}`);
  });
  render(<PluginStoreManager onChanged={() => undefined} />);

  expect(await screen.findByText("Demo")).toBeInTheDocument();

  const file = new File(["zip"], "plugin.zip", { type: "application/zip" });
  const input = document.querySelector(
    'input[type="file"]',
  ) as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(
      "/plugin-store/upload",
      "POST",
      expect.any(FormData),
    ),
  );

  fireEvent.click(screen.getByRole("button", { name: "Desactivar Demo" }));
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith("/extensions/custom.demo", "PATCH", {
      enabled: false,
    }),
  );
});

it("updates an installed plugin when a newer ZIP is available", async () => {
  let installed = { enabled: true, version: "1.2.0" };
  vi.mocked(api).mockImplementation(async (path, method) => {
    if (path === "/plugin-store")
      return {
        data: [
          {
            ...item,
            version: "1.3.0",
            manifest: { ...item.manifest, version: "1.3.0" },
            installed,
          },
        ],
      };
    if (path === "/extensions/custom.demo/install" && method === "POST") {
      installed = { enabled: true, version: "1.3.0" };
      return { data: { id: "custom.demo", ...installed } };
    }
    throw new Error(`Unexpected API request: ${path}`);
  });
  render(<PluginStoreManager onChanged={() => undefined} />);

  fireEvent.click(
    await screen.findByRole("button", { name: "Actualizar Demo" }),
  );
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith("/extensions/custom.demo/install", "POST"),
  );
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "Actualizar Demo" }),
    ).not.toBeInTheDocument(),
  );
});

it("muestra el estado vacío del store", async () => {
  vi.mocked(api).mockResolvedValue({ data: [] });
  render(<PluginStoreManager onChanged={() => undefined} />);
  expect(
    await screen.findByText("Aún no subiste plugins a este espacio."),
  ).toBeInTheDocument();
});

it("agrupa varias versiones del mismo plugin en una sola tarjeta", async () => {
  const installed = { enabled: true, version: "2.0.3" };
  const versions = ["1.3.0", "1.3.1", "2.0.0", "2.0.3"].map((version) => ({
    ...item,
    version,
    manifest: { ...item.manifest, version },
    installed,
  }));
  vi.mocked(api).mockResolvedValue({ data: versions });
  render(<PluginStoreManager onChanged={() => undefined} />);

  expect(await screen.findByText("Demo")).toBeInTheDocument();
  expect(screen.getAllByText("Demo")).toHaveLength(1);
  expect(screen.getByText("2.0.3")).toBeInTheDocument();
  expect(screen.getByText("4 versiones")).toBeInTheDocument();
  expect(
    screen.getByText("Mostrando 1 de 1 plugins"),
  ).toBeInTheDocument();
});
