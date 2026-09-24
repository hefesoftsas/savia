// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import DynamicForm from "../dynamic-form";
import { makeConfig, objectSchema, validateRecord } from "@savia/studio-shared/metadata";

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

it("validates section conditions against existing fields", () => {
  expect(() =>
    objectSchema.parse({
      name: "demo",
      label: "Demo",
      description: "",
      config: {
        version: 2,
        fieldOrder: ["show_extra", "extra"],
        fields: {
          show_extra: { type: "Toggle", label: "Mostrar extra" },
          extra: {
            type: "Textbox",
            label: "Extra",
            config: { section: "extra_section" },
          },
        },
        studio: {
          sections: [
            {
              id: "extra_section",
              label: "Extra",
              visibleWhen: { field: "missing", op: "eq", value: true },
            },
          ],
        },
      },
    }),
  ).toThrow(/condición referencia un campo inexistente/i);
});

it("hides section fields until the section condition is met", async () => {
  const object = {
    name: "demo",
    label: "Demo",
    description: "",
    config: {
      ...makeConfig({
        show_extra: { type: "Toggle", label: "Mostrar extra" },
        extra: {
          type: "Textbox",
          label: "Extra",
          config: { section: "extra_section" },
        },
      }),
      studio: {
        sections: [
          {
            id: "extra_section",
            label: "Datos extra",
            visibleWhen: { field: "show_extra", op: "eq", value: true },
          },
        ],
      },
    },
  };
  render(
    <QueryClientProvider client={new QueryClient()}>
      <DynamicForm object={object} onSave={vi.fn()} />
    </QueryClientProvider>,
  );

  expect(screen.queryByText("Datos extra")).not.toBeInTheDocument();
  expect(screen.getByLabelText("Extra")).not.toBeVisible();

  fireEvent.click(screen.getByRole("switch", { name: "Mostrar extra" }));

  expect(await screen.findByText("Datos extra")).toBeVisible();
  expect(screen.getByLabelText("Extra")).toBeVisible();
});

it("does not require hidden section fields on save", () => {
  const object = {
    name: "demo",
    label: "Demo",
    description: "",
    config: {
      ...makeConfig({
        show_extra: { type: "Toggle", label: "Mostrar extra", defaultValue: false },
        extra: {
          type: "Textbox",
          label: "Extra",
          required: true,
          config: { section: "extra_section" },
        },
      }),
      studio: {
        sections: [
          {
            id: "extra_section",
            label: "Datos extra",
            visibleWhen: { field: "show_extra", op: "eq", value: true },
          },
        ],
      },
    },
  };

  expect(validateRecord(object, { show_extra: false }).errors.extra).toBeUndefined();
  expect(
    validateRecord(object, { show_extra: true }).errors.extra,
  ).toBeTruthy();
});
