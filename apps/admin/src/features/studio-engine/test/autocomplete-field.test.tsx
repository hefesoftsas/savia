// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import DynamicForm from "../dynamic-form";
import {
  makeConfig,
  objectSchema,
  validateRecord,
  type StudioObject,
} from "@savia/studio-shared/metadata";

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const object: StudioObject = {
  name: "catalog",
  label: "Catálogo",
  description: "",
  config: makeConfig({
    city: {
      type: "Autocomplete",
      label: "Ciudad",
      required: true,
      options: [
        { value: "bogota", label: "Bogotá" },
        { value: "medellin", label: "Medellín" },
        { value: "cali", label: "Cali" },
      ],
    },
  }),
};

it("accepts Autocomplete in metadata and validates selected options", () => {
  expect(objectSchema.safeParse(object).success).toBe(true);
  expect(
    validateRecord(object, { city: "medellin" }).errors,
  ).toEqual({});
  expect(
    validateRecord(object, { city: "invalid" }).errors.city,
  ).toBeTruthy();
});

it("renders a searchable combobox and saves the selected option", async () => {
  let saved: Record<string, unknown> | null = null;
  render(
    <QueryClientProvider client={new QueryClient()}>
      <DynamicForm
        object={object}
        onSave={async (data) => {
          saved = data;
        }}
        submitLabel="Guardar"
      />
    </QueryClientProvider>,
  );

  fireEvent.click(screen.getByRole("combobox", { name: "Ciudad" }));
  fireEvent.click(await screen.findByText("Medellín"));
  fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

  await waitFor(() => {
    expect(saved).toEqual({ city: "medellin" });
  });
});
