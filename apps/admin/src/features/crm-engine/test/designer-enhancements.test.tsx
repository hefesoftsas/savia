// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, it, expect, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import DynamicForm from "../dynamic-form";
import { RelationField } from "../fields";
import { makeConfig, type CrmObject } from "@savia/crm-shared/metadata";
beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
function mount(child: React.ReactNode) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      {child}
    </QueryClientProvider>,
  );
}
it("calculates chained values live and validates conditional required fields before submit", async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  const object: CrmObject = {
    name: "estimates",
    label: "Estimaciones",
    description: "",
    config: makeConfig({
      quantity: { type: "Number", label: "Cantidad", defaultValue: 2 },
      price: { type: "Number", label: "Precio", defaultValue: 5 },
      total: {
        type: "Number",
        label: "Total",
        config: { formula: { op: "product", fields: ["quantity", "price"] } },
      },
      approved: { type: "Toggle", label: "Aprobado" },
      reason: {
        type: "Textbox",
        label: "Motivo",
        config: {
          visibleWhen: { field: "approved", op: "eq", value: true },
          requiredWhen: { field: "approved", op: "eq", value: true },
        },
      },
    }),
  };
  mount(<DynamicForm object={object} onSave={save} />);
  const quantity = await screen.findByRole("spinbutton", { name: "Cantidad" });
  expect(
    (screen.getByRole("spinbutton", { name: "Total" }) as HTMLInputElement)
      .value,
  ).toBe("10");
  fireEvent.change(quantity, { target: { value: "4" } });
  await waitFor(() =>
    expect(
      (screen.getByRole("spinbutton", { name: "Total" }) as HTMLInputElement)
        .value,
    ).toBe("20"),
  );
  fireEvent.click(screen.getByRole("switch", { name: "Aprobado" }));
  fireEvent.click(screen.getByRole("button", { name: "Guardar registro" }));
  await screen.findByText("Motivo: obligatorio");
  expect(save).not.toHaveBeenCalled();
  fireEvent.input(screen.getByRole("textbox", { name: "Motivo" }), {
    target: { value: "Aceptado" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Guardar registro" }));
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        quantity: 4,
        total: 20,
        approved: true,
        reason: "Aceptado",
      }),
    ),
  );
});
it("relation selector requests later pages and preserves multiple choices while searching", async () => {
  const fetcher = vi.fn(async (input: string) => {
    const url = new URL(input, "http://localhost");
    if (url.pathname.endsWith("/chosen"))
      return new Response(
        JSON.stringify({ data: { id: "chosen", name: "Empresa elegida" } }),
        { status: 200 },
      );
    const page = Number(url.searchParams.get("page") ?? 1);
    const data =
      page === 1
        ? Array.from({ length: 20 }, (_, i) => ({
            id: `id_${i}`,
            name: `Empresa ${i}`,
          }))
        : [{ id: "later", name: "Empresa posterior" }];
    return new Response(JSON.stringify({ data, total: 21 }), { status: 200 });
  });
  vi.stubGlobal("fetch", fetcher);
  const setFieldValue = vi.fn();
  mount(
    <>
      <label id="accounts_label">Empresas</label>
      <RelationField
        fieldName="accounts"
        config={{ relation: "accounts", multiple: true }}
        value={["chosen"]}
        setFieldValue={setFieldValue}
      />
    </>,
  );
  await screen.findByRole("button", { name: "Empresa 0" });
  fireEvent.click(screen.getByRole("button", { name: "Siguiente" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "Empresa posterior" }),
  );
  expect(setFieldValue).toHaveBeenCalledWith("accounts", ["chosen", "later"]);
  fireEvent.change(screen.getByRole("textbox", { name: "Empresas" }), {
    target: { value: "Nueva" },
  });
  await waitFor(() =>
    expect(
      fetcher.mock.calls.some(
        ([url]) => url.includes("q=Nueva") && url.includes("page=1"),
      ),
    ).toBe(true),
  );
});
it("preserves untouched single and multiple relationships when editing another field", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      const path = new URL(input, "http://localhost").pathname;
      const id = path.split("/").at(-1)!;
      return Response.json(
        id === "accounts"
          ? { data: [{ id: "a3", name: "Otra empresa" }], total: 1 }
          : { data: { id, name: `Empresa ${id}` } },
      );
    }),
  );
  const save = vi.fn().mockResolvedValue(undefined);
  const object: CrmObject = {
    name: "related_edit",
    label: "Edición",
    description: "",
    config: makeConfig({
      name: { type: "Textbox", label: "Nombre" },
      account: {
        type: "Dropdown",
        label: "Empresa",
        options: [],
        config: { relation: "accounts" },
      },
      partners: {
        type: "Dropdown",
        label: "Aliados",
        options: [{ value: "opcion_1", label: "Opción inicial" }],
        config: { relation: "accounts", multiple: true },
      },
    }),
  };
  mount(
    <DynamicForm
      object={object}
      values={{
        id: "record_1",
        name: "Anterior",
        account: "a1",
        partners: ["a1", "a2"],
      }}
      onSave={save}
    />,
  );
  await screen.findByRole("button", { name: "Quitar Empresa a2" });
  expect(
    screen.getAllByRole("button", { name: "Quitar Empresa a1" }),
  ).toHaveLength(2);
  fireEvent.input(screen.getByRole("textbox", { name: "Nombre" }), {
    target: { value: "Actualizado" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Guardar registro" }));
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith({
      name: "Actualizado",
      account: "a1",
      partners: ["a1", "a2"],
    }),
  );
  fireEvent.click(
    screen.getAllByRole("button", { name: "Quitar Empresa a1" })[0],
  );
  fireEvent.click(screen.getByRole("button", { name: "Quitar Empresa a2" }));
  fireEvent.click(screen.getByRole("button", { name: "Guardar registro" }));
  await waitFor(() =>
    expect(save).toHaveBeenLastCalledWith({
      name: "Actualizado",
      account: null,
      partners: ["a1"],
    }),
  );
});
