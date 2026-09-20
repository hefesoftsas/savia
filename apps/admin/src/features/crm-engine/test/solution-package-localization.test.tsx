// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { render as baseRender } from "@testing-library/react";
import { StoreContextProvider, memoryStore } from "ra-core";
import { AppLocaleProvider } from "@/i18n/app-locale-provider";
import SolutionManager from "../solution-manager";
import { api } from "../api";

vi.mock("../api", () => ({ api: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

const manifest = {
  format: "savia.solution",
  formatVersion: 1,
  id: "savia.insurance",
  version: "1.5.0",
  label: "Seguros",
  description: "Modelos de seguros",
  labels: { en: "Insurance", pt: "Seguros" },
  descriptions: { en: "Insurance models" },
  requires: [],
  objects: [
    {
      name: "clientes",
      label: "Clientes",
      description: "Personas aseguradas.",
      labels: { en: "Customers" },
      config: { version: 2, fields: {}, fieldOrder: [] },
    },
    {
      name: "polizas",
      label: "Pólizas",
      description: "",
      config: { version: 2, fields: {}, fieldOrder: [] },
    },
  ],
};
// The preview response carries default labels only; the UI resolves
// translations from the posted candidate manifest.
const preview = {
  id: "savia.insurance",
  version: "1.5.0",
  objects: [
    { name: "clientes", label: "Clientes", action: "create" },
    { name: "polizas", label: "Pólizas", action: "create" },
  ],
  conflicts: [],
  canInstall: true,
};

function renderWithLocale(locale: "es" | "en" | "pt") {
  vi.mocked(api).mockImplementation(async (url) => {
    if (url === "/solutions")
      return { data: [{ manifest, installed: null }] };
    if (url === "/solutions/preview") return { data: preview };
    return { data: {} };
  });
  const store = memoryStore({ locale });
  baseRender(
    <StoreContextProvider value={store}>
      <AppLocaleProvider>
        <SolutionManager onChanged={vi.fn()} />
      </AppLocaleProvider>
    </StoreContextProvider>,
  );
}

it("shows translated package labels while keeping stored defaults", async () => {
  renderWithLocale("en");
  expect(await screen.findByText("Insurance")).toBeInTheDocument();
  expect(screen.queryByText("Seguros")).not.toBeInTheDocument();
});

it("resolves preview object labels from the candidate and falls back", async () => {
  renderWithLocale("en");
  fireEvent.click(
    await screen.findByRole("button", { name: "Review Insurance" }),
  );
  expect(await screen.findByText("Customers")).toBeInTheDocument();
  // "Pólizas" has no English override, so the default label is preserved.
  expect(screen.getByText("Pólizas")).toBeInTheDocument();
});

it("keeps Spanish defaults when translations are absent", async () => {
  renderWithLocale("es");
  expect(await screen.findByText("Seguros")).toBeInTheDocument();
});
