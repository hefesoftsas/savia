// @vitest-environment jsdom
import React, { useState } from "react";
import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { render } from "./locale-test-render";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { makeConfig } from "@savia/crm-shared/metadata";
import { RelatedRecordEditor } from "../related-record-editor";
import { api } from "../api";
vi.mock("../api", () => ({ api: vi.fn() }));
vi.mock("../runtime", () => ({
  getCrmRuntime: () => ({
    apiBasePath: "/v1/data-domains/platform",
    domainId: "platform",
  }),
}));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
const child = {
  name: "clients",
  label: "Clientes",
  description: "",
  config: makeConfig({
    name: { type: "Textbox", label: "Nombre", required: true },
    code: { type: "Textbox", label: "Código", readOnly: true },
  }),
};
function mount(
  initial: any[] = [],
  readOnly = false,
  config: Record<string, unknown> = {},
  parentSubmit = vi.fn(),
) {
  const changed = vi.fn();
  vi.mocked(api).mockImplementation(async (path) =>
    path === "/objects/clients"
      ? { data: child }
      : { data: { id: "c1", name: "Ana", code: "fixed", _version: 3 } },
  );
  function Harness() {
    const [value, setValue] = useState(initial);
    return (
      <form onSubmit={parentSubmit}>
        <label htmlFor="name">Parent name</label>
        <input id="name" />
        <RelatedRecordEditor
          fieldName="clients"
          value={value}
          readOnly={readOnly}
          config={{
            collectionRelationTarget: "clients",
            relationPresentation: "table",
            multiple: true,
            ...config,
          }}
          setFieldValue={(_name, next) => {
            setValue(next);
            changed(next);
          }}
        />
      </form>
    );
  }
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <Harness />
    </QueryClientProvider>,
  );
  return changed;
}
it("loads details on demand, validates and stages a new child without writing", async () => {
  const changed = mount();
  expect(api).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: /Mostrar registros/ }));
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Crear relacionado" }),
    ).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Crear relacionado" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "Aplicar al formulario" }),
  );
  expect(await screen.findByText("Nombre: obligatorio")).toBeInTheDocument();
  expect(changed).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText(/Nombre/), {
    target: { value: "Nueva" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Aplicar al formulario" }),
  );
  await waitFor(() =>
    expect(changed).toHaveBeenCalledWith([
      { data: expect.objectContaining({ name: "Nueva" }) },
    ]),
  );
  expect(vi.mocked(api).mock.calls.every(([, method]) => !method)).toBe(true);
});
it("stages edits with the existing version and preserves readonly values", async () => {
  const changed = mount([{ id: "c1" }]);
  fireEvent.click(screen.getByRole("button", { name: /Mostrar registros/ }));
  fireEvent.click(await screen.findByRole("button", { name: /Editar Ana/ }));
  const input = await screen.findByLabelText(/Nombre/);
  fireEvent.change(input, { target: { value: "Editada" } });
  expect(screen.getByLabelText("Código")).toBeDisabled();
  fireEvent.click(
    screen.getByRole("button", { name: "Aplicar al formulario" }),
  );
  await waitFor(() =>
    expect(changed).toHaveBeenCalledWith([
      {
        id: "c1",
        version: 3,
        data: expect.objectContaining({ name: "Editada" }),
      },
    ]),
  );
});
it("unlinks explicitly without deleting and respects readonly", async () => {
  const changed = mount([{ id: "c1" }]);
  fireEvent.click(screen.getByRole("button", { name: /Mostrar registros/ }));
  fireEvent.click(
    await screen.findByRole("button", { name: /Desvincular Ana/ }),
  );
  expect(changed).toHaveBeenCalledWith([]);
  expect(vi.mocked(api).mock.calls.every(([, method]) => !method)).toBe(true);
  cleanup();
  mount([{ id: "c1" }], true);
  fireEvent.click(screen.getByRole("button", { name: /Mostrar registros/ }));
  expect(
    await screen.findByRole("button", { name: /Desvincular Ana/ }),
  ).toBeDisabled();
  expect(
    screen.getByRole("button", { name: "Crear relacionado" }),
  ).toBeDisabled();
});
it("loads one visible page and keeps unvisited rows when unlinking", async () => {
  const original = Array.from({ length: 21 }, (_, index) => ({
    id: `c${index + 1}`,
  }));
  const changed = mount(original);
  fireEvent.click(screen.getByRole("button", { name: /Mostrar registros/ }));
  await screen.findAllByRole("button", { name: /Desvincular Ana/ });
  expect(
    vi.mocked(api).mock.calls.filter(([path]) => path.startsWith("/records/")),
  ).toHaveLength(10);
  fireEvent.click(
    screen.getByRole("button", { name: "Siguiente", exact: true }),
  );
  await waitFor(() => expect(api).toHaveBeenCalledWith("/records/clients/c20"));
  fireEvent.click(
    (await screen.findAllByRole("button", { name: /Desvincular Ana/ }))[0],
  );
  expect(changed).toHaveBeenLastCalledWith(
    original.filter((row) => row.id !== "c11"),
  );
});
it("edits a genuine inline subform without a nested native form and stages invalid fields", async () => {
  const changed = mount([], false, {
    relationPresentation: "subform",
    relationFields: [],
  });
  fireEvent.click(screen.getByRole("button", { name: /Mostrar registros/ }));
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Crear relacionado" }),
    ).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Crear relacionado" }));
  const name = await screen.findByLabelText(/Nombre/);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(document.querySelectorAll("form")).toHaveLength(1);
  expect(name).not.toBe(screen.getByLabelText("Parent name"));
  expect(screen.queryByLabelText("Código")).not.toBeInTheDocument();
  await waitFor(() =>
    expect(changed).toHaveBeenLastCalledWith([
      expect.objectContaining({ __errors: ["Nombre: obligatorio"] }),
    ]),
  );
  fireEvent.change(name, { target: { value: "Inline" } });
  await waitFor(() =>
    expect(changed).toHaveBeenLastCalledWith([{ data: { name: "Inline" } }]),
  );
  expect(vi.mocked(api).mock.calls.every(([, method]) => !method)).toBe(true);
});

it("allows editing an unsaved new row when only creation is enabled", async () => {
  mount([{ data: { name: "Draft" } }, { id: "c1" }], false, {
    relationAllowEdit: false,
  });
  fireEvent.click(screen.getByRole("button", { name: /Mostrar registros/ }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Editar Draft" })).toBeEnabled(),
  );
  expect(
    await screen.findByRole("button", { name: "Editar Ana" }),
  ).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Editar Draft" }));
  expect(await screen.findByLabelText(/Nombre/)).toHaveValue("Draft");
});
it("isolates child modal submission from the parent form", async () => {
  const parentSubmit = vi.fn();
  mount([], false, {}, parentSubmit);
  fireEvent.click(screen.getByRole("button", { name: /Mostrar registros/ }));
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Crear relacionado" }),
    ).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Crear relacionado" }));
  const input = await screen.findByLabelText(/Nombre/);
  fireEvent.submit(input.closest("form")!);
  expect(parentSubmit).not.toHaveBeenCalled();
});

it("switches between unsaved inline rows without resetting the active draft", async () => {
  const changed = mount(
    [{ data: { name: "First" } }, { data: { name: "Second" } }],
    false,
    { relationPresentation: "subform" },
  );
  fireEvent.click(screen.getByRole("button", { name: /Mostrar registros/ }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Editar First" })).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Editar First" }));
  expect(await screen.findByLabelText(/Nombre/)).toHaveValue("First");
  fireEvent.click(screen.getByRole("button", { name: "Editar Second" }));
  await waitFor(() =>
    expect(screen.getByLabelText(/Nombre/)).toHaveValue("Second"),
  );
  fireEvent.change(screen.getByLabelText(/Nombre/), {
    target: { value: "Updated" },
  });
  await waitFor(() =>
    expect(changed).toHaveBeenLastCalledWith([
      { data: { name: "First" } },
      { data: { name: "Updated" } },
    ]),
  );
});
