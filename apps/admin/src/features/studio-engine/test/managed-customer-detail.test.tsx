// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import { render } from "./locale-test-render";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import RecordDetail from "../record-detail";
import { api } from "../api";
import { setStudioRuntime } from "../runtime";
import { makeConfig } from "@savia/studio-shared/metadata";
vi.mock("../api", () => ({
  api: vi.fn(),
  studioFetch: vi.fn(),
  downloadCrm: vi.fn(),
}));
afterEach(() => {
  cleanup();
  setStudioRuntime({ embedded: false });
});
it("keeps canonical customer details without querying unsupported generic activity and files", async () => {
  const record = {
    id: "12",
    name: "Cliente original",
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
    _version: 1,
  };
  vi.mocked(api).mockResolvedValue({ data: { record, relations: [] } });
  setStudioRuntime({
    embedded: true,
    domainId: "platform",
    transport: async () =>
      Response.json({ data: { active: false, links: [] } }),
  });
  const config = makeConfig({ name: { type: "Textbox", label: "Nombre" } });
  config.studio = { ...config.studio, business: "managed-customer" };
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <RecordDetail
        object={{
          name: "clientes",
          label: "Clientes",
          description: "",
          config,
        }}
        record={record}
        onEdit={() => {}}
        onClose={() => {}}
        onRefresh={() => {}}
      />
    </QueryClientProvider>,
  );
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith("/record-detail/clientes/12?page=1"),
  );
  expect(screen.getByRole("button", { name: "Información" })).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Actividad" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Tareas" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: /Archivos/ }),
  ).not.toBeInTheDocument();
  expect(vi.mocked(api).mock.calls.map(([path]) => path)).toEqual([
    "/record-detail/clientes/12?page=1",
  ]);
});

it("honors read-only source capabilities without edit or local-storage actions", async () => {
  const record = {
    id: "remote-12",
    name: "Contacto remoto",
    created_at: "",
    updated_at: "invalid",
  };
  vi.mocked(api).mockClear();
  vi.mocked(api).mockResolvedValue({ data: { record, relations: [] } });
  const config = makeConfig({ name: { type: "Textbox", label: "Nombre" } });
  config.studio = {
    ...config.studio,
    collection: {
      sourceId: "external",
      resource: "contacts",
      kind: "jsonapi",
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
  };
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <RecordDetail
        object={{
          name: "remote_contacts",
          label: "Contactos",
          description: "",
          config,
        }}
        record={record}
        onEdit={() => {}}
        onClose={() => {}}
        onRefresh={() => {}}
      />
    </QueryClientProvider>,
  );
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(
      "/record-detail/remote_contacts/remote-12?page=1",
    ),
  );
  expect(
    screen.queryByRole("button", { name: "Editar" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Actividad" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Tareas" }),
  ).not.toBeInTheDocument();
  expect(vi.mocked(api).mock.calls.map(([path]) => path)).toEqual([
    "/record-detail/remote_contacts/remote-12?page=1",
  ]);
});
