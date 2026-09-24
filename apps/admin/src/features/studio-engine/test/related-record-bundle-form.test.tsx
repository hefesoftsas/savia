// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { render } from "./locale-test-render";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { makeConfig } from "@savia/studio-shared/metadata";
import CollectionRecordForm from "../collection-record-form";
import { api } from "../api";
vi.mock("../api", () => ({ api: vi.fn() }));
vi.mock("../runtime", () => ({
  getStudioRuntime: () => ({
    apiBasePath: "/v1/data-domains/platform",
    domainId: "platform",
  }),
}));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
const relation = {
  id: "r1",
  sourceObject: "parents",
  targetObject: "children",
  sourceLabel: "Padres",
  targetLabel: "Hijos",
  storage: "local",
  cardinality: "one-to-many",
  sourceField: "id",
  targetField: "id",
  version: 1,
};
const object = {
  name: "parents",
  label: "Padres",
  description: "",
  config: makeConfig({
    name: { type: "Textbox", label: "Nombre principal", required: true },
    children: {
      type: "Textbox",
      label: "Hijos",
      config: {
        collectionRelation: "r1",
        relationPresentation: "table",
        multiple: true,
      },
    },
  }),
};
it("bundles child data, strips virtual fields and retains changes after a rejected save", async () => {
  vi.mocked(api).mockImplementation(async (path) =>
    path === "/collection-relations"
      ? { data: [relation] }
      : path === "/objects/children"
        ? {
            data: {
              name: "children",
              label: "Hijos",
              description: "",
              config: makeConfig({
                name: {
                  type: "Textbox",
                  label: "Nombre del hijo",
                  required: true,
                },
              }),
            },
          }
        : { data: [] },
  );
  const save = vi
    .fn()
    .mockRejectedValueOnce(new Error("Conflicto de versión"))
    .mockResolvedValue({ id: "p1", _version: 1 });
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <CollectionRecordForm object={object} onSave={save} />
    </QueryClientProvider>,
  );
  fireEvent.change(await screen.findByLabelText(/Nombre principal/), {
    target: { value: "Principal" },
  });
  fireEvent.click(screen.getByRole("button", { name: /Mostrar registros/ }));
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Crear relacionado" }),
    ).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Crear relacionado" }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.submit(dialog.querySelector("form")!);
  expect(save).not.toHaveBeenCalled();
  fireEvent.change(within(dialog).getByLabelText(/Nombre del hijo/), {
    target: { value: "Nuevo hijo" },
  });
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Aplicar al formulario" }),
  );
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Guardar registro" }));
  await screen.findByText("Conflicto de versión");
  expect(save.mock.calls[0][0]).toEqual({ name: "Principal" });
  expect(save.mock.calls[0][2]).toEqual([
    {
      relationId: "r1",
      previousIds: [],
      rows: [{ data: { name: "Nuevo hijo" } }],
    },
  ]);
  expect(screen.getAllByText("Nuevo hijo").length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole("button", { name: "Guardar registro" }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  expect(save.mock.calls[1][2]).toEqual(save.mock.calls[0][2]);
  expect(vi.mocked(api).mock.calls.every(([, method]) => !method)).toBe(true);
});
it("blocks parent save for an invalid inline child and includes edits without an apply step", async () => {
  vi.mocked(api).mockImplementation(async (path) =>
    path === "/collection-relations"
      ? { data: [relation] }
      : path === "/objects/children"
        ? {
            data: {
              name: "children",
              label: "Hijos",
              description: "",
              config: makeConfig({
                name: {
                  type: "Textbox",
                  label: "Nombre del hijo",
                  required: true,
                },
              }),
            },
          }
        : { data: [] },
  );
  const save = vi.fn().mockResolvedValue({ id: "p1", _version: 1 });
  const inline = {
    ...object,
    config: {
      ...object.config,
      fields: {
        ...object.config.fields,
        children: {
          ...object.config.fields.children,
          config: {
            ...object.config.fields.children.config,
            relationPresentation: "subform" as const,
          },
        },
      },
    },
  };
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <CollectionRecordForm object={inline} onSave={save} />
    </QueryClientProvider>,
  );
  fireEvent.change(await screen.findByLabelText(/Nombre principal/), {
    target: { value: "Principal" },
  });
  fireEvent.click(screen.getByRole("button", { name: /Mostrar registros/ }));
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Crear relacionado" }),
    ).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Crear relacionado" }));
  await screen.findByText("Nombre del hijo: obligatorio");
  fireEvent.click(screen.getByRole("button", { name: "Guardar registro" }));
  await screen.findByText(
    "Revisa los campos del registro relacionado antes de guardar.",
  );
  expect(save).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText(/Nombre del hijo/), {
    target: { value: "En línea" },
  });
  await waitFor(() =>
    expect(
      screen.queryByText("Nombre del hijo: obligatorio"),
    ).not.toBeInTheDocument(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Guardar registro" }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  expect(save.mock.calls[0][2]).toEqual([
    {
      relationId: "r1",
      previousIds: [],
      rows: [{ data: { name: "En línea" } }],
    },
  ]);
});
