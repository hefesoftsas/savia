// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "./locale-test-render";
import Audit from "../audit-panel";
import { api, downloadCrm } from "../api";
vi.mock("../api", () => ({ api: vi.fn(), downloadCrm: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
const event = {
  id: "event-1",
  action: "record.updated",
  object_name: "clients",
  record_id: "record-123",
  created_at: "2026-09-28T12:00:00Z",
  detail: { before: { name: "Before" }, after: { name: "After" } },
};
function mount() {
  vi.mocked(api).mockResolvedValue({ data: [event] });
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <Audit objectName="clients" />
    </QueryClientProvider>,
  );
}
it("expands full details and exports the same screen scope", async () => {
  mount();
  fireEvent.click(await screen.findByText("Registro actualizado"));
  expect(screen.getByText("record-123")).toBeVisible();
  expect(screen.getByText(/"Before"/)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Exportar CSV" }));
  await waitFor(() =>
    expect(downloadCrm).toHaveBeenCalledWith(
      "/api/audit/export.csv?object=clients",
      "historial.csv",
    ),
  );
});
it("requires confirmation before deleting a single event", async () => {
  mount();
  fireEvent.click(await screen.findByText("Registro actualizado"));
  fireEvent.click(screen.getByRole("button", { name: "Eliminar evento" }));
  expect(api).not.toHaveBeenCalledWith("/audit/event-1", "DELETE");
  fireEvent.click(
    screen.getByRole("button", { name: "Confirmar eliminación" }),
  );
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith("/audit/event-1", "DELETE"),
  );
});
it("cancels bulk deletion and then deletes only the current screen scope", async () => {
  mount();
  await screen.findByText("Registro actualizado");
  fireEvent.click(screen.getByRole("button", { name: "Eliminar todos" }));
  expect(
    screen.getByText(/Se eliminará todo el historial de esta pantalla/),
  ).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
  expect(api).not.toHaveBeenCalledWith("/audit?object=clients", "DELETE");
  fireEvent.click(screen.getByRole("button", { name: "Eliminar todos" }));
  fireEvent.click(
    screen.getByRole("button", { name: "Confirmar eliminación" }),
  );
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith("/audit?object=clients", "DELETE"),
  );
});
