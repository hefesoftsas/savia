// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { render } from "./locale-test-render";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import CollectionRecordForm from "../collection-record-form";
import { api } from "../api";
import { makeConfig } from "@savia/crm-shared/metadata";
vi.mock("../api", () => ({ api: vi.fn() }));
vi.mock("../runtime", () => ({
  getCrmRuntime: () => ({
    apiBasePath: "/v1/data-domains/platform",
    domainId: "platform",
  }),
}));
const object = {
  name: "test",
  label: "Test",
  description: "",
  config: makeConfig({
    name: { type: "Textbox", label: "Nombre", required: true },
    cliente_id: {
      type: "Textbox",
      label: "cliente_id",
      config: { collectionRelation: "r1" },
    },
  }),
};
const relation = {
  id: "r1",
  sourceObject: "clients",
  targetObject: "test",
  sourceLabel: "Test",
  targetLabel: "Clientes",
  storage: "local",
  cardinality: "one-to-many",
  sourceField: "id",
  targetField: "id",
  version: 1,
};
function mount(onSave: any, onSaved = vi.fn(), values = {}) {
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <CollectionRecordForm
        object={object}
        values={values}
        onSave={onSave}
        onSaved={onSaved}
      />
    </QueryClientProvider>,
  );
}
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
function responses(failLink = false) {
  let failed = false;
  vi.mocked(api).mockImplementation(async (path, method) => {
    if (path === "/collection-relations") return { data: [relation] };
    if (path.startsWith("/records/clients"))
      return path.includes("?")
        ? {
            data: [
              { id: "c1", display_name: "Ana Pérez" },
              { id: "c2", display_name: "Cliente dos" },
            ],
            total: 2,
          }
        : { data: { id: "c1", display_name: "Ana Pérez" } };
    if (method === "POST" && failLink && !failed) {
      failed = true;
      throw new Error("No se pudo vincular");
    }
    return { data: [] };
  });
}
it("shows a client selector on creation and saves the link after the record", async () => {
  responses();
  const save = vi
    .fn()
    .mockResolvedValue({ id: "new-1", name: "Prueba", _version: 1 });
  const done = vi.fn();
  mount(save, done);
  fireEvent.click(
    await screen.findByRole("combobox", { name: "cliente_id", exact: true }),
  );
  fireEvent.click(
    await screen.findByRole("option", { name: "Ana Pérez", exact: true }),
  );
  fireEvent.change(screen.getByLabelText(/Nombre/), {
    target: { value: "Prueba" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Guardar registro" }));
  await waitFor(() => expect(done).toHaveBeenCalled());
  expect(api).toHaveBeenCalledWith("/record-links/test/new-1/r1", "POST", {
    targetId: "c1",
  });
  expect(save.mock.calls[0][0]).toEqual({ name: "Prueba", cliente_id: "c1" });
  expect(
    screen.queryByText("Relaciones", { exact: true }),
  ).not.toBeInTheDocument();
});
it("retries linking using the already created record instead of creating again", async () => {
  responses(true);
  const saved = { id: "new-1", name: "Prueba", _version: 1 };
  const save = vi.fn().mockResolvedValue(saved);
  const done = vi.fn();
  mount(save, done);
  fireEvent.click(
    await screen.findByRole("combobox", { name: "cliente_id", exact: true }),
  );
  fireEvent.click(
    await screen.findByRole("option", { name: "Ana Pérez", exact: true }),
  );
  fireEvent.change(screen.getByLabelText(/Nombre/), {
    target: { value: "Prueba" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Guardar registro" }));
  await screen.findByText(/No se pudo vincular/);
  expect(done).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Guardar registro" }));
  await waitFor(() => expect(done).toHaveBeenCalled());
  expect(save.mock.calls[1][1]).toEqual(saved);
});
it("does not save a record if relation definitions cannot be loaded", async () => {
  vi.mocked(api).mockRejectedValue(new Error("Relaciones no disponibles"));
  const save = vi.fn();
  mount(save);
  await screen.findByText("Relaciones no disponibles");
  expect(
    screen.queryByRole("button", { name: "Guardar registro" }),
  ).not.toBeInTheDocument();
  expect(save).not.toHaveBeenCalled();
});
it("replaces an existing single client by unlinking before linking", async () => {
  responses();
  const original = vi.mocked(api).getMockImplementation()!;
  vi.mocked(api).mockImplementation(async (path, method, ...rest) => {
    if (path.startsWith("/record-links/test/existing?") && !method)
      return {
        data: [
          {
            definition: relation,
            records: [{ id: "c1", label: "Ana Pérez" }],
            total: 1,
          },
        ],
      };
    return original(path, method, ...rest);
  });
  const save = vi
    .fn()
    .mockResolvedValue({ id: "existing", name: "Prueba", _version: 2 });
  const done = vi.fn();
  mount(save, done, { id: "existing", name: "Prueba", _version: 1 });
  fireEvent.click(
    await screen.findByRole("combobox", { name: "cliente_id", exact: true }),
  );
  fireEvent.click(
    await screen.findByRole("option", { name: "Cliente dos", exact: true }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Guardar registro" }));
  await waitFor(() => expect(done).toHaveBeenCalled());
  const mutations = vi
    .mocked(api)
    .mock.calls.filter((call) => call[1] === "DELETE" || call[1] === "POST");
  expect(mutations).toEqual([
    ["/record-links/test/existing/r1", "DELETE", { targetId: "c1" }],
    ["/record-links/test/existing/r1", "POST", { targetId: "c2" }],
  ]);
});
it("retains multiple selected records on the many side", async () => {
  responses();
  const original = vi.mocked(api).getMockImplementation()!;
  vi.mocked(api).mockImplementation(async (path, ...rest) =>
    path === "/collection-relations"
      ? { data: [{ ...relation, cardinality: "many-to-many" }] }
      : original(path, ...rest),
  );
  const save = vi
    .fn()
    .mockResolvedValue({ id: "new-1", name: "Prueba", _version: 1 });
  const done = vi.fn();
  mount(save, done);
  fireEvent.click(
    await screen.findByRole("combobox", { name: "cliente_id", exact: true }),
  );
  fireEvent.click(
    await screen.findByRole("option", { name: "Ana Pérez", exact: true }),
  );
  fireEvent.click(
    screen.getByRole("option", { name: "Cliente dos", exact: true }),
  );
  fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" });
  fireEvent.change(screen.getByLabelText(/Nombre/), {
    target: { value: "Prueba" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Guardar registro" }));
  await waitFor(() => expect(done).toHaveBeenCalled());
  expect(api).toHaveBeenCalledWith("/record-links/test/new-1/r1", "POST", {
    targetId: "c1",
  });
  expect(api).toHaveBeenCalledWith("/record-links/test/new-1/r1", "POST", {
    targetId: "c2",
  });
});
it("uses the newest saved version after a later link failure", async () => {
  responses();
  const original = vi.mocked(api).getMockImplementation()!;
  let failLink = true;
  vi.mocked(api).mockImplementation(async (path, method, ...rest) => {
    if (method === "POST" && failLink) {
      failLink = false;
      throw new Error("Fallo de vínculo");
    }
    return original(path, method, ...rest);
  });
  const first = { id: "new-1", name: "Prueba", _version: 1 };
  const second = { ...first, _version: 2 };
  const save = vi
    .fn()
    .mockResolvedValueOnce(first)
    .mockResolvedValueOnce(second)
    .mockResolvedValue({ ...first, _version: 3 });
  const done = vi.fn().mockImplementationOnce(() => {
    throw new Error("Fallo posterior al guardado");
  });
  mount(save, done);
  await screen.findByRole("combobox", { name: "cliente_id", exact: true });
  fireEvent.change(screen.getByLabelText(/Nombre/), {
    target: { value: "Prueba" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Guardar registro" }));
  await screen.findByText("Fallo posterior al guardado");
  fireEvent.click(
    screen.getByRole("combobox", { name: "cliente_id", exact: true }),
  );
  fireEvent.click(
    await screen.findByRole("option", { name: "Ana Pérez", exact: true }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Guardar registro" }));
  await screen.findByText(/Fallo de vínculo/);
  fireEvent.click(screen.getByRole("button", { name: "Guardar registro" }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(3));
  expect(save.mock.calls[2][1]).toEqual(second);
});
