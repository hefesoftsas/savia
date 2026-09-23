// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import React from "react";
import { it, expect, vi, afterEach, beforeEach } from "vitest";
import { screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { render } from "./locale-test-render";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import DynamicForm from "../dynamic-form";
import WizardDesigner from "../wizard-designer";
import {
  WizardStepAssignmentCanvas,
  buildWizardStepFieldOrder,
} from "../wizard-step-assignment-canvas";
import { reorderSections } from "../form-sections-editor";
import { buildGroupedFieldOrder } from "../designer-field-dnd";
import {
  DesignerProvider,
  createInitialDesignerState,
} from "@form-eng/designer";
import {
  makeConfig,
  objectSchema,
  type StudioObject,
} from "@savia/studio-shared/metadata";
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
const object: StudioObject = {
  name: "wizard_test",
  label: "Solicitud",
  description: "",
  config: {
    ...makeConfig({
      name: {
        type: "Textbox",
        label: "Nombre",
        required: true,
        config: { step: "identity" },
      },
      email: {
        type: "Textbox",
        label: "Correo",
        required: true,
        config: { step: "details", format: "email" },
      },
      qty: {
        type: "Number",
        label: "Cantidad",
        defaultValue: 2,
        config: { step: "details", minimum: 1 },
      },
      price: {
        type: "Number",
        label: "Precio",
        defaultValue: 10,
        config: { step: "identity" },
      },
      total: {
        type: "Number",
        label: "Total",
        config: {
          step: "details",
          formula: { op: "product", fields: ["qty", "price"] },
        },
      },
    }),
    studio: {
      wizard: {
        enabled: true,
        presentation: "steps",
        steps: [
          { id: "identity", title: "Identidad" },
          {
            id: "details",
            title: "Detalles",
            description: "Completa tu solicitud.",
          },
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
it("validates current step, retains values and calculations across navigation, and saves only at the end", async () => {
  const save = mount();
  await screen.findByRole("textbox", { name: "Nombre" });
  expect(screen.queryByRole("textbox", { name: "Correo" })).toBeNull();
  const currentStep = screen
    .getByRole("navigation", { name: "Pasos del formulario" })
    .querySelector('[aria-current="step"]');
  expect(currentStep?.textContent).toContain("Identidad");
  expect(screen.queryByRole("button", { name: /Identidad/i })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Siguiente paso" }));
  await screen.findByText("Nombre: obligatorio");
  expect(save).not.toHaveBeenCalled();
  fireEvent.input(screen.getByRole("textbox", { name: "Nombre" }), {
    target: { value: "Proyecto" },
  });
  fireEvent.change(screen.getByRole("spinbutton", { name: "Precio" }), {
    target: { value: "15" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Siguiente paso" }));
  await screen.findByRole("textbox", { name: "Correo" });
  expect(screen.getByRole("button", { name: /Identidad/i })).toBeTruthy();
  expect(screen.queryByRole("textbox", { name: "Nombre" })).toBeNull();
  expect(
    (screen.getByRole("spinbutton", { name: "Total" }) as HTMLInputElement)
      .value,
  ).toBe("30");
  expect(save).not.toHaveBeenCalled();
  fireEvent.input(screen.getByRole("textbox", { name: "Correo" }), {
    target: { value: "invalido" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Guardar registro" }));
  await screen.findByText("Correo: correo inválido");
  expect(save).not.toHaveBeenCalled();
  fireEvent.input(screen.getByRole("textbox", { name: "Correo" }), {
    target: { value: "demo@example.com" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Anterior", exact: true }),
  );
  await screen.findByRole("textbox", { name: "Nombre" });
  expect(
    (screen.getByRole("textbox", { name: "Nombre" }) as HTMLInputElement).value,
  ).toBe("Proyecto");
  fireEvent.click(screen.getByRole("button", { name: "Siguiente paso" }));
  await screen.findByRole("textbox", { name: "Correo" });
  expect(
    (screen.getByRole("textbox", { name: "Correo" }) as HTMLInputElement).value,
  ).toBe("demo@example.com");
  fireEvent.click(screen.getByRole("button", { name: "Guardar registro" }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  expect(save).toHaveBeenCalledWith({
    name: "Proyecto",
    email: "demo@example.com",
    qty: 2,
    price: 15,
    total: 30,
  });
});
it("returns to an earlier step if a later value activates its required condition", async () => {
  const o = structuredClone(object);
  o.config.fields.name.required = false;
  o.config.fields.name.config = {
    step: "identity",
    requiredWhen: { field: "qty", op: "gt", value: 2 },
  };
  const save = mount(o);
  fireEvent.click(
    await screen.findByRole("button", { name: "Siguiente paso" }),
  );
  await screen.findByRole("textbox", { name: "Correo" });
  fireEvent.input(screen.getByRole("textbox", { name: "Correo" }), {
    target: { value: "a@b.com" },
  });
  fireEvent.change(screen.getByRole("spinbutton", { name: "Cantidad" }), {
    target: { value: "3" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Guardar registro" }));
  await screen.findByRole("textbox", { name: "Nombre" });
  await screen.findByText("Nombre: obligatorio");
  expect(save).not.toHaveBeenCalled();
  expect(document.activeElement?.id).toBe("name");
});
it("retains the last step and user inputs after a failed final save; blocks duplicate submits while pending", async () => {
  let reject: (e: Error) => void = () => {};
  const save = vi.fn().mockImplementation(
    () =>
      new Promise((_, r) => {
        reject = r;
      }),
  );
  mount(object, save, {
    id: "existing",
    name: "Original",
    email: "a@b.com",
    qty: 2,
    price: 10,
  });
  fireEvent.click(
    await screen.findByRole("button", { name: "Siguiente paso" }),
  );
  await screen.findByRole("textbox", { name: "Correo" });
  fireEvent.click(screen.getByRole("button", { name: "Guardar registro" }));
  await screen.findByRole("button", { name: "Guardando…" });
  expect(
    (
      screen.getByRole("button", {
        name: "Anterior",
        exact: true,
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  reject(new Error("Otra edición modificó este registro."));
  await screen.findByText("Otra edición modificó este registro.");
  expect(screen.getByRole("textbox", { name: "Correo" })).toBeTruthy();
  expect(save).toHaveBeenCalledTimes(1);
});
it("disabled wizards keep the ordinary single-page form", async () => {
  const o = structuredClone(object);
  o.config.studio!.wizard!.enabled = false;
  mount(o);
  await screen.findByRole("textbox", { name: "Nombre" });
  expect(screen.getByRole("textbox", { name: "Correo" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Siguiente paso" })).toBeNull();
});
it("validates step assignments, duplicate identifiers and empty steps in metadata", () => {
  expect(objectSchema.safeParse(object).success).toBe(true);
  for (const mutate of [
    (o: StudioObject) => {
      o.config.studio!.wizard!.steps[1].id = "identity";
    },
    (o: StudioObject) => {
      delete o.config.fields.name.config!.step;
    },
    (o: StudioObject) => {
      o.config.fields.name.config!.step = "missing";
    },
    (o: StudioObject) => {
      o.config.studio!.wizard!.steps.push({ id: "empty", title: "Vacío" });
    },
  ]) {
    const o = structuredClone(object);
    mutate(o);
    expect(objectSchema.safeParse(o).success).toBe(false);
  }
});
it("configures the wizard from the designer and assigns existing fields", async () => {
  const setStudio = vi.fn();
  const fields = {
    name: { type: "Textbox", label: "Nombre" },
    email: { type: "Textbox", label: "Correo" },
  };
  render(
    <DesignerProvider
      initialState={{
        ...createInitialDesignerState(),
        fields,
        fieldOrder: ["name", "email"],
      }}
    >
      <WizardDesigner
        studio={{ columns: 1, sections: [] }}
        setStudio={setStudio}
      />
    </DesignerProvider>,
  );
  fireEvent.click(screen.getByRole("switch", { name: "Activar wizard" }));
  expect(setStudio).toHaveBeenCalledWith(
    expect.objectContaining({
      wizard: expect.objectContaining({
        enabled: true,
        steps: expect.arrayContaining([
          expect.objectContaining({ title: "Datos principales" }),
          expect.objectContaining({ title: "Detalles" }),
        ]),
      }),
    }),
  );
});
it("groups visible fields into wizard step drop zones", async () => {
  const user = userEvent.setup();
  render(
    <DesignerProvider
      initialState={{
        ...createInitialDesignerState(),
        fields: {
          plate: {
            type: "Textbox",
            label: "Placa",
            config: { step: "vehicle" },
          },
          name: {
            type: "Textbox",
            label: "Nombre",
            config: { step: "person" },
          },
        },
        fieldOrder: ["plate", "name"],
      }}
    >
      <WizardStepAssignmentCanvas
        wizard={{
          enabled: true,
          presentation: "steps",
          steps: [
            { id: "vehicle", title: "Vehículo" },
            { id: "person", title: "Persona" },
          ],
        }}
        onChange={() => {}}
      />
    </DesignerProvider>,
  );
  expect(
    screen.getByRole("region", { name: "1. Vehículo (1 campos)" }),
  ).toHaveTextContent("Placa");
  expect(
    screen.getByRole("region", { name: "2. Persona (1 campos)" }),
  ).toHaveTextContent("Nombre");
  await user.selectOptions(
    screen.getByRole("combobox", { name: "Mover Placa a paso" }),
    "person",
  );
  await waitFor(() =>
    expect(
      screen.getByRole("region", { name: "2. Persona (2 campos)" }),
    ).toHaveTextContent("Placa"),
  );
  expect(
    screen.getByRole("region", { name: "1. Vehículo (0 campos)" }),
  ).toBeInTheDocument();
});
it("builds field order when reordering within a wizard step", () => {
  const fields = {
    plate: { config: { step: "vehicle" } },
    year: { config: { step: "vehicle" } },
    name: { config: { step: "person" } },
  };
  const stepIds = new Set(["vehicle", "person"]);
  expect(
    buildWizardStepFieldOrder(
      ["plate", "year", "name"],
      fields,
      "year",
      "vehicle",
      stepIds,
      "plate",
    ),
  ).toEqual(["year", "plate", "name"]);
  expect(
    buildWizardStepFieldOrder(
      ["plate", "year", "name"],
      fields,
      "name",
      "vehicle",
      stepIds,
    ),
  ).toEqual(["plate", "year", "name"]);
});
it("reorders form sections before a target or at the end", () => {
  const sections = [
    { id: "a", label: "A" },
    { id: "b", label: "B" },
    { id: "c", label: "C" },
  ];
  expect(reorderSections(sections, "c", "a")).toEqual([
    { id: "c", label: "C" },
    { id: "a", label: "A" },
    { id: "b", label: "B" },
  ]);
  expect(reorderSections(sections, "a")).toEqual([
    { id: "b", label: "B" },
    { id: "c", label: "C" },
    { id: "a", label: "A" },
  ]);
});
it("builds field order when reordering within a grouped section", () => {
  const fields = {
    plate: { config: { section: "vehicle" } },
    year: { config: { section: "vehicle" } },
    name: { config: { section: "person" } },
  };
  const sectionIds = new Set(["vehicle", "person"]);
  expect(
    buildGroupedFieldOrder(
      ["plate", "year", "name"],
      fields,
      "year",
      "vehicle",
      sectionIds,
      "plate",
    ),
  ).toEqual(["year", "plate", "name"]);
});
