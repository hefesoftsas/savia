// @vitest-environment jsdom
import React from "react";
import { it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import DynamicForm from "../dynamic-form";
import { makeConfig, type CrmObject } from "@savia/crm-shared/metadata";
beforeEach(() =>
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  ),
);
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const object: CrmObject = {
  name: "conversation",
  label: "Solicitud",
  description: "",
  config: {
    ...makeConfig({
      name: {
        type: "Textbox",
        label: "Tu nombre",
        required: true,
        config: { step: "first" },
      },
      plan: {
        type: "Dropdown",
        label: "Elige un plan",
        required: true,
        options: [
          { label: "Básico", value: "basic" },
          { label: "Avanzado", value: "advanced" },
        ],
        config: { step: "first" },
      },
      email: {
        type: "Textbox",
        label: "Tu correo",
        required: true,
        config: { step: "second", format: "email" },
      },
      notes: {
        type: "Textarea",
        label: "Algo más",
        config: { step: "second" },
      },
    }),
    studio: {
      wizard: {
        enabled: true,
        steps: [
          { id: "first", title: "Comencemos" },
          { id: "second", title: "Contacto" },
        ],
      },
    },
  },
};
function mount(
  o = object,
  save = vi.fn().mockResolvedValue(undefined),
  values?: Record<string, unknown>,
) {
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <DynamicForm object={o} onSave={save} values={values} />
    </QueryClientProvider>,
  );
  return save;
}
async function fillIdentity() {
  const input = await screen.findByRole("textbox", { name: "Tu nombre" });
  fireEvent.input(input, { target: { value: "Ana" } });
  fireEvent.keyDown(input, { key: "Enter" });
  const plan = await screen.findByRole("radio", { name: /Avanzado/ });
  fireEvent.keyDown(plan, { key: "Home" });
  fireEvent.keyDown(screen.getByRole("radio", { name: /Básico/ }), {
    key: "ArrowDown",
  });
  expect(
    screen
      .getByRole("radio", { name: /Avanzado/ })
      .getAttribute("aria-checked"),
  ).toBe("true");
  fireEvent.click(
    screen.getByRole("button", { name: "Continuar", exact: true }),
  );
  await screen.findByRole("textbox", { name: "Tu correo" });
}
it("focuses one question, validates Enter, presents shadcn choices and reviews before saving", async () => {
  const save = mount();
  const name = await screen.findByRole("textbox", { name: "Tu nombre" });
  expect(name.getAttribute("aria-required")).toBe("true");
  expect(screen.queryByRole("textbox", { name: "Tu correo" })).toBeNull();
  fireEvent.keyDown(name, { key: "Enter" });
  await screen.findByText("Tu nombre: obligatorio");
  expect(document.activeElement?.id).toBe("name");
  await fillIdentity();
  fireEvent.input(screen.getByRole("textbox", { name: "Tu correo" }), {
    target: { value: "ana@example.com" },
  });
  fireEvent.keyDown(screen.getByRole("textbox", { name: "Tu correo" }), {
    key: "Enter",
  });
  const notes = await screen.findByRole("textbox", { name: "Algo más" });
  fireEvent.keyDown(notes, { key: "Enter" });
  expect(screen.queryByRole("button", { name: "Guardar registro" })).toBeNull();
  fireEvent.input(notes, { target: { value: "Gracias" } });
  fireEvent.keyDown(notes, { key: "Enter", ctrlKey: true });
  await screen.findByRole("heading", { name: "¿Todo está bien?" });
  expect(screen.getByText("Ana")).toBeTruthy();
  expect(screen.getByText("Avanzado", { selector: "dd" })).toBeTruthy();
  expect(save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Cambiar Tu nombre" }));
  const edit = await screen.findByRole("textbox", { name: "Tu nombre" });
  expect((edit as HTMLInputElement).value).toBe("Ana");
  fireEvent.input(edit, { target: { value: "Ana María" } });
  fireEvent.click(screen.getByRole("button", { name: "Volver a la revisión" }));
  await screen.findByRole("heading", { name: "¿Todo está bien?" });
  fireEvent.click(screen.getByRole("button", { name: "Guardar registro" }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  expect(save).toHaveBeenCalledWith({
    name: "Ana María",
    plan: "advanced",
    email: "ana@example.com",
    notes: "Gracias",
  });
  await screen.findByText("Listo, tus respuestas se guardaron.");
});
it("preserves answers when going back and skips conditional questions", async () => {
  const o = structuredClone(object);
  o.config.fields.email.config!.visibleWhen = {
    field: "plan",
    op: "eq",
    value: "advanced",
  };
  const save = mount(o);
  fireEvent.input(await screen.findByRole("textbox", { name: "Tu nombre" }), {
    target: { value: "Ana" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Continuar", exact: true }),
  );
  fireEvent.click(await screen.findByRole("radio", { name: /Básico/ }));
  fireEvent.click(
    screen.getByRole("button", { name: "Continuar", exact: true }),
  );
  await screen.findByRole("textbox", { name: "Algo más" });
  expect(screen.queryByRole("textbox", { name: "Tu correo" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Atrás", exact: true }));
  const plan = await screen.findByRole("radio", { name: /Básico/ });
  expect(plan.getAttribute("aria-checked")).toBe("true");
  expect(save).not.toHaveBeenCalled();
});
it("keeps the review and answers after a network error, and disables duplicate submissions", async () => {
  let reject: (e: Error) => void = () => {};
  const save = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((_, r) => {
          reject = r;
        }),
    )
    .mockResolvedValue(undefined);
  mount(object, save, {
    id: "edit",
    name: "Ana",
    plan: "basic",
    email: "ana@example.com",
    notes: "Hola",
  });
  fireEvent.click(
    await screen.findByRole("button", { name: "Continuar", exact: true }),
  );
  await screen.findByRole("radio", { name: /Básico/ });
  fireEvent.click(
    screen.getByRole("button", { name: "Continuar", exact: true }),
  );
  await screen.findByRole("textbox", { name: "Tu correo" });
  fireEvent.click(
    screen.getByRole("button", { name: "Continuar", exact: true }),
  );
  await screen.findByRole("textbox", { name: "Algo más" });
  fireEvent.click(screen.getByRole("button", { name: "Revisar respuestas" }));
  await screen.findByRole("heading", { name: "¿Todo está bien?" });
  fireEvent.click(screen.getByRole("button", { name: "Guardar registro" }));
  await screen.findByRole("button", { name: "Guardando…" });
  expect(
    (
      screen.getByRole("button", {
        name: "Cambiar Tu nombre",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  reject(new Error("No hay conexión. Inténtalo de nuevo."));
  await screen.findByText("No hay conexión. Inténtalo de nuevo.");
  expect(
    screen.getByRole("heading", { name: "¿Todo está bien?" }),
  ).toBeTruthy();
  expect(screen.getByText("ana@example.com")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Guardar registro" }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
});
it("keeps remote relations and computed values on edits even if they are not the focused question", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: any) =>
      Response.json(
        String(url).includes("/a1")
          ? { data: { id: "a1", name: "Empresa uno" } }
          : { data: [], total: 0 },
      ),
    ),
  );
  const o: CrmObject = {
    name: "relation_wizard",
    label: "Relaciones",
    description: "",
    config: {
      ...makeConfig({
        name: { type: "Textbox", label: "Nombre", config: { step: "first" } },
        company: {
          type: "Dropdown",
          label: "Empresa",
          options: [],
          config: { step: "second", relation: "account" },
        },
        a: {
          type: "Number",
          label: "A",
          defaultValue: 2,
          readOnly: true,
          config: { step: "first" },
        },
        b: {
          type: "Number",
          label: "B",
          defaultValue: 3,
          readOnly: true,
          config: { step: "first" },
        },
        total: {
          type: "Number",
          label: "Total",
          config: {
            step: "second",
            formula: { op: "product", fields: ["a", "b"] },
          },
        },
      }),
      studio: {
        wizard: {
          enabled: true,
          steps: [
            { id: "first", title: "Datos" },
            { id: "second", title: "Relación" },
          ],
        },
      },
    },
  };
  const save = mount(o, undefined, {
    id: "r1",
    name: "Original",
    company: "a1",
    a: 2,
    b: 3,
  });
  fireEvent.click(
    await screen.findByRole("button", { name: "Continuar", exact: true }),
  );
  await screen.findByRole("textbox", { name: "Empresa" });
  fireEvent.click(screen.getByRole("button", { name: "Revisar respuestas" }));
  await screen.findByRole("heading", { name: "¿Todo está bien?" });
  await screen.findByText("Empresa uno");
  fireEvent.click(screen.getByRole("button", { name: "Guardar registro" }));
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith({
      name: "Original",
      company: "a1",
      a: 2,
      b: 3,
      total: 6,
    }),
  );
});
