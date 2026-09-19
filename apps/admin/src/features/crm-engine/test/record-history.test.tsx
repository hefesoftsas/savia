// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { makeConfig } from "@savia/crm-shared/metadata";
import { api } from "../api";
import RecordHistory from "../record-history";
vi.mock("../api", () => ({ api: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
const object = {
  name: "contacts",
  label: "Contactos",
  description: "",
  config: makeConfig({ name: { type: "Textbox", label: "Nombre" } }),
};
const entry = {
  version: 2,
  action: "updated",
  createdAt: "2026-09-19T12:00:00Z",
  actor: { kind: "user", id: null, causeId: null },
  fields: ["name"],
};
it("loads summaries, defers values, and pages using server cursors", async () => {
  vi.mocked(api).mockImplementation(async (path) =>
    path.endsWith("/2")
      ? {
          data: {
            ...entry,
            changes: { name: { before: "Old", after: "New" } },
          },
        }
      : {
          data: [entry],
          nextCursor: path.includes("cursor=") ? null : "next",
          enabled: true,
          retentionDays: 90,
        },
  );
  render(<RecordHistory object={object} recordId="one" />);
  await screen.findByText("Registro actualizado");
  expect(api).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: /Ver cambios/ }));
  await screen.findByText("Old");
  fireEvent.click(screen.getByRole("button", { name: "Anteriores" }));
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(
      expect.stringContaining("cursor=next"),
      "GET",
      undefined,
      expect.objectContaining({ cache: "no-store" }),
    ),
  );
  expect(screen.queryByText("Old")).not.toBeInTheDocument();
});
it("clears previous values on refresh errors and record changes", async () => {
  vi.mocked(api).mockResolvedValue({
    data: [entry],
    nextCursor: null,
    enabled: true,
    retentionDays: 90,
  });
  const view = render(<RecordHistory object={object} recordId="one" />);
  await screen.findByText("Registro actualizado");
  vi.mocked(api).mockRejectedValue(new Error("Acceso denegado"));
  fireEvent.click(screen.getByRole("button", { name: "Actualizar historial" }));
  await screen.findByText("Acceso denegado");
  expect(screen.queryByText("Registro actualizado")).not.toBeInTheDocument();
  view.rerender(<RecordHistory object={object} recordId="two" />);
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(
      expect.stringContaining("/two?"),
      "GET",
      undefined,
      expect.anything(),
    ),
  );
});

it("does not retain summaries after detail authorization fails", async () => {
  vi.mocked(api).mockImplementation(async (path) => {
    if (path.endsWith("/2"))
      throw Object.assign(new Error("Acceso revocado"), { status: 403 });
    return {
      data: [entry],
      nextCursor: null,
      enabled: true,
      retentionDays: 90,
    };
  });
  render(<RecordHistory object={object} recordId="one" />);
  fireEvent.click(await screen.findByRole("button", { name: /Ver cambios/ }));
  await screen.findByText("Acceso revocado");
  expect(screen.queryByText("Registro actualizado")).not.toBeInTheDocument();
});

import RecordHistorySettingsButton from "../record-history-settings";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
it("reloads stale settings before another save and uses the fresh version", async () => {
  let version = 3;
  vi.mocked(api).mockImplementation(async (_path, method) => {
    if (method === "PUT") {
      version = 4;
      throw new Error("Configuración modificada por otra persona");
    }
    return {
      data: { enabled: false, fields: ["name"], retentionDays: 90 },
      version,
    };
  });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RecordHistorySettingsButton object={object} />
    </QueryClientProvider>,
  );
  expect(api).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Configurar historial" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "Guardar configuración" }),
  );
  await screen.findByText("Configuración modificada por otra persona");
  expect(
    screen.queryByRole("button", { name: "Guardar configuración" }),
  ).not.toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: "Recargar configuración" }),
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "Guardar configuración" }),
  );
  await waitFor(() =>
    expect(api).toHaveBeenLastCalledWith(
      "/record-history-settings/contacts",
      "PUT",
      expect.objectContaining({ expectedVersion: 4 }),
      expect.anything(),
    ),
  );
});
it("hides configuration from roles without schema access", () => {
  const restricted = {
    ...object,
    config: {
      ...object.config,
      studio: {
        capabilities: {
          list: true,
          read: true,
          create: false,
          update: false,
          delete: false,
          schema: false,
          customFields: false,
        },
      },
    },
  };
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RecordHistorySettingsButton object={restricted} />
    </QueryClientProvider>,
  );
  expect(
    screen.queryByRole("button", { name: "Configurar historial" }),
  ).not.toBeInTheDocument();
  expect(api).not.toHaveBeenCalled();
});

import RecordDetail from "../record-detail";
it("mounts history only when its tab is opened, including read-only custom roles", async () => {
  const record = { id: "one", name: "Current" };
  vi.mocked(api).mockImplementation(async (path) =>
    path.startsWith("/record-detail/")
      ? { data: { record, relations: [] } }
      : path.startsWith("/record-history/")
        ? { data: [], nextCursor: null, enabled: false, retentionDays: 90 }
        : { data: [], total: 0 },
  );
  const restricted = {
    ...object,
    config: {
      ...object.config,
      studio: {
        capabilities: {
          list: true,
          read: true,
          create: false,
          update: false,
          delete: false,
          schema: false,
          customFields: false,
        },
      },
    },
  };
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RecordDetail
        object={restricted}
        record={record}
        onEdit={vi.fn()}
        onClose={vi.fn()}
        onRefresh={vi.fn()}
      />
    </QueryClientProvider>,
  );
  expect(
    vi
      .mocked(api)
      .mock.calls.some(([path]) => path.startsWith("/record-history/")),
  ).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Historial" }));
  await screen.findByText(/No hay cambios conservados/);
});

import { setCrmRuntime } from "../runtime";
it("discards a late response after the workspace changes", async () => {
  let resolveFirst!: (value: unknown) => void;
  vi.mocked(api)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
    )
    .mockResolvedValue({
      data: [],
      nextCursor: null,
      enabled: true,
      retentionDays: 90,
    });
  setCrmRuntime({ embedded: false, domainId: "first" });
  const view = render(<RecordHistory object={object} recordId="one" />);
  setCrmRuntime({ embedded: false, domainId: "second" });
  view.rerender(<RecordHistory object={object} recordId="one" />);
  await screen.findByText(/No hay cambios conservados/);
  resolveFirst({
    data: [entry],
    nextCursor: null,
    enabled: true,
    retentionDays: 90,
  });
  await waitFor(() =>
    expect(screen.queryByText("Registro actualizado")).not.toBeInTheDocument(),
  );
  setCrmRuntime({ embedded: false });
});

it("requires an explicit field selection and reloads comparison after a conflict", async () => {
  vi.mocked(api).mockImplementation(async (path, method) => {
    if (path.endsWith("/restore")) {
      if (method === "PUT")
        throw Object.assign(new Error("El registro cambió"), { status: 409 });
      return {
        data: {
          expectedVersion: 3,
          changes: {
            name: { current: "Current", before: "Old", after: "New" },
          },
        },
      };
    }
    return path.endsWith("/2")
      ? {
          data: {
            ...entry,
            changes: { name: { before: "Old", after: "New" } },
          },
        }
      : { data: [entry], nextCursor: null, enabled: true, retentionDays: 90 };
  });
  render(<RecordHistory object={object} recordId="one" />);
  fireEvent.click(await screen.findByRole("button", { name: /Ver cambios/ }));
  fireEvent.click(
    await screen.findByRole("button", { name: "Restaurar campos" }),
  );
  await screen.findByText("Current");
  expect(
    screen.getByRole("button", { name: "Confirmar restauración" }),
  ).toBeDisabled();
  fireEvent.click(screen.getByRole("checkbox", { name: "Nombre" }));
  fireEvent.click(
    screen.getByRole("button", { name: "Confirmar restauración" }),
  );
  await screen.findByText(/El registro cambió/);
  expect(
    screen.queryByRole("button", { name: "Confirmar restauración" }),
  ).not.toBeInTheDocument();
  expect(api).toHaveBeenCalledWith(
    expect.stringContaining("/2/restore"),
    "PUT",
    { expectedVersion: 3, side: "before", fields: ["name"] },
    expect.anything(),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Revisar comparación de nuevo" }),
  );
  await screen.findByText("Current");
  expect(
    screen.getByRole("button", { name: "Confirmar restauración" }),
  ).toBeDisabled();
});

it("loads bounded usage only on request and labels partial counts", async () => {
  const { RecordHistoryUsage } = await import("../record-history-usage");
  vi.mocked(api).mockResolvedValue({
    data: {
      events: 1000,
      logicalBytes: 30000,
      expiredEvents: 5,
      oldestExpiredAt: null,
      limited: true,
      measuredAt: "2026-09-19T12:00:00Z",
    },
  });
  render(<RecordHistoryUsage path="/record-history-settings/contacts" />);
  expect(api).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: "Consultar consumo del historial" }),
  );
  await screen.findByText(/Medición parcial/);
  expect(screen.getByText("Al menos 5")).toBeInTheDocument();
  expect(api).toHaveBeenCalledWith(
    "/record-history-settings/contacts/usage",
    "GET",
    undefined,
    expect.objectContaining({ cache: "no-store" }),
  );
});
