// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { render } from "./locale-test-render";
import { PluginRegistry } from "../plugin-registry";
import { api } from "../api";
vi.mock("../api", () => ({ api: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
const release = {
  id: "custom.demo",
  version: "1.2.0",
  label: "Shared demo",
  sha256: "a".repeat(64),
  sizeBytes: 1200,
  createdAt: "2026-09-30T00:00:00Z",
};
it("hides the shared registry when the tenant is not configured", async () => {
  vi.mocked(api).mockResolvedValue({
    configured: false,
    data: [],
    cursor: null,
  });
  render(<PluginRegistry onImported={vi.fn()} />);
  await waitFor(() => expect(api).toHaveBeenCalled());
  expect(screen.queryByText("Catálogo compartido")).not.toBeInTheDocument();
});
it("imports the selected immutable version without activating it", async () => {
  vi.mocked(api).mockImplementation(async (path) =>
    path === "/plugin-store/registry"
      ? { configured: true, data: [release], cursor: null }
      : { data: { id: release.id } },
  );
  const imported = vi.fn();
  render(<PluginRegistry onImported={imported} />);
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Añadir al espacio Shared demo 1.2.0",
    }),
  );
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith("/plugin-store/registry/import", "POST", {
      id: release.id,
      version: release.version,
      sha256: release.sha256,
    }),
  );
  await waitFor(() => expect(imported).toHaveBeenCalledOnce());
  expect(api).not.toHaveBeenCalledWith(
    expect.stringContaining("/install"),
    expect.anything(),
  );
  expect(await screen.findByText("Añadido al espacio")).toBeInTheDocument();
});
it("provides retry without replacing the local store on a registry outage", async () => {
  vi.mocked(api)
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue({ configured: true, data: [], cursor: null });
  render(<PluginRegistry onImported={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: "Reintentar" }));
  expect(
    await screen.findByText("No hay versiones publicadas."),
  ).toBeInTheDocument();
});

it("installs the imported pinned version explicitly", async () => {
  vi.mocked(api).mockImplementation(async (path) =>
    path === "/plugin-store/registry"
      ? { configured: true, data: [release], cursor: null }
      : { data: { id: release.id } },
  );
  render(<PluginRegistry onImported={vi.fn()} />);
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Añadir al espacio Shared demo 1.2.0",
    }),
  );
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Instalar versión Shared demo 1.2.0",
    }),
  );
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(
      "/extensions/custom.demo/install",
      "POST",
      { version: "1.2.0" },
    ),
  );
  expect(await screen.findByText("Versión instalada")).toBeInTheDocument();
});
