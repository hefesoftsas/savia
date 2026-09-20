// @vitest-environment jsdom
import React from "react";
import { it, expect, vi, afterEach, beforeEach } from "vitest";
import { screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { render } from "./locale-test-render";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import DynamicForm from "../dynamic-form";
import { DependentOptionsEditor } from "../dependent-options";
import {
  makeConfig,
  objectSchema,
  validateRecord,
  type CrmObject,
} from "@savia/crm-shared/metadata";
import { availableOptions } from "@savia/crm-shared/dependent-options";
const options = (values: string[]) =>
  values.map((value) => ({ value, label: value }));
const object: CrmObject = {
  name: "cascade",
  label: "Vehículo",
  description: "",
  config: {
    ...makeConfig({
      brand: {
        type: "Dropdown",
        label: "Marca",
        required: true,
        options: options(["Toyota", "Renault"]),
        config: { step: "brand" },
      },
      model: {
        type: "Dropdown",
        label: "Modelo",
        required: true,
        options: options(["Corolla", "Yaris", "Clio"]),
        config: {
          step: "model",
          optionsWhen: {
            field: "brand",
            cases: { Toyota: ["Corolla", "Yaris"], Renault: ["Clio"] },
          },
        },
      },
    }),
    studio: {
      wizard: {
        enabled: true,
        steps: [
          { id: "brand", title: "Marca" },
          { id: "model", title: "Modelo" },
        ],
      },
    },
  },
};
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
it("validates dependencies and rejects cycles, missing options and incompatible records", () => {
  expect(objectSchema.safeParse(object).success).toBe(true);
  expect(
    validateRecord(object, { brand: "Toyota", model: "Clio" }).errors.model,
  ).toBeTruthy();
  expect(
    validateRecord(object, { brand: "Renault", model: "Clio" }).errors,
  ).toEqual({});
  expect(
    availableOptions(
      object.config.fields.model.options,
      object.config.fields.model.config!.optionsWhen as any,
      {},
    ),
  ).toEqual([]);
  const cycle = structuredClone(object);
  cycle.config.fields.brand.config!.optionsWhen = {
    field: "model",
    cases: { Clio: ["Renault"] },
  };
  expect(objectSchema.safeParse(cycle).success).toBe(false);
  const missing = structuredClone(object);
  missing.config.fields.model.config!.optionsWhen = {
    field: "unknown",
    cases: { Toyota: ["Unknown"] },
  };
  expect(objectSchema.safeParse(missing).success).toBe(false);
});
it("preserves valid existing answers and clears incompatible answers when the parent changes in a wizard", async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  render(
    <QueryClientProvider client={new QueryClient()}>
      <DynamicForm
        object={object}
        values={{ brand: "Toyota", model: "Corolla" }}
        onSave={save}
      />
    </QueryClientProvider>,
  );
  await screen.findByRole("radio", { name: "Toyota" });
  fireEvent.click(
    screen.getByRole("button", { name: "Continuar", exact: true }),
  );
  expect(
    (await screen.findByRole("radio", { name: "Corolla" })).getAttribute(
      "aria-checked",
    ),
  ).toBe("true");
  expect(screen.queryByRole("radio", { name: "Clio" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Atrás", exact: true }));
  fireEvent.click(await screen.findByRole("radio", { name: "Renault" }));
  fireEvent.click(
    screen.getByRole("button", { name: "Continuar", exact: true }),
  );
  const clio = await screen.findByRole("radio", { name: "Clio" });
  expect(clio.getAttribute("aria-checked")).toBe("false");
  fireEvent.click(screen.getByRole("button", { name: "Revisar respuestas" }));
  await screen.findByText("Modelo: obligatorio");
  fireEvent.click(clio);
  fireEvent.click(screen.getByRole("button", { name: "Revisar respuestas" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "Guardar registro" }),
  );
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith({ brand: "Renault", model: "Clio" }),
  );
});
it("allows configuring allowed children for each parent option visually", () => {
  const change = vi.fn();
  render(
    <DependentOptionsEditor
      name="model"
      fields={object.config.fields}
      value={{ field: "brand", cases: {} }}
      onChange={change}
    />,
  );
  const group = screen.getByRole("group", { name: "Cuando Marca es Toyota" });
  fireEvent.click(group.querySelector("input")!);
  expect(change).toHaveBeenCalledWith({
    field: "brand",
    cases: { Toyota: ["Corolla"] },
  });
});

it("filters the standard form dropdown as well as conversational choices", async () => {
  const plain = structuredClone(object);
  plain.config.studio!.wizard!.enabled = false;
  render(
    <QueryClientProvider client={new QueryClient()}>
      <DynamicForm
        object={plain}
        values={{ brand: "Toyota", model: "Corolla" }}
        onSave={vi.fn()}
      />
    </QueryClientProvider>,
  );
  const model = await screen.findByRole("combobox", { name: "Modelo" });
  fireEvent.keyDown(model, { key: "ArrowDown" });
  expect(await screen.findByRole("option", { name: "Yaris" })).toBeTruthy();
  expect(screen.queryByRole("option", { name: "Clio" })).toBeNull();
});
