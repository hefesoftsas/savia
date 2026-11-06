// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { render } from "./studio-test-render";
import { makeConfig, type StudioObject } from "@savia/studio-shared/metadata";
import PluginLookupSettings from "../plugin-lookup-settings";
const api = vi.fn();
vi.mock("../api", () => ({ api: (...args: unknown[]) => api(...args) }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
const source: StudioObject = {
  name: "cases",
  label: "Cases",
  description: "",
  version: 3,
  config: makeConfig({
    customer: { type: "Textbox", label: "Customer", required: true },
  }),
};
const target: StudioObject = {
  name: "people",
  label: "People",
  description: "",
  config: makeConfig({
    display_name: { type: "Textbox", label: "Display name" },
    tax_id: { type: "Textbox", label: "Tax ID" },
    private_field: { type: "Textbox", label: "Private", hidden: true },
  }),
};
it("configures arbitrary compatible collection and fields with a versioned schema write", async () => {
  api.mockResolvedValue({ data: {} });
  const onSaved = vi.fn();
  render(
    <PluginLookupSettings
      object={source}
      objects={[source, target]}
      fields={["customer"]}
      onSaved={onSaved}
      onBack={() => {}}
    />,
  );
  fireEvent.change(screen.getByLabelText("Entrada del campo"), {
    target: { value: "lookup" },
  });
  fireEvent.change(screen.getByLabelText("Colección de origen"), {
    target: { value: "people" },
  });
  fireEvent.change(screen.getByLabelText("Texto que se muestra"), {
    target: { value: "display_name" },
  });
  fireEvent.click(screen.getByRole("checkbox", { name: "Tax ID" }));
  expect(
    screen.queryByRole("checkbox", { name: "Private" }),
  ).not.toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: "Guardar configuración" }),
  );
  await waitFor(() => expect(onSaved).toHaveBeenCalled());
  expect(api).toHaveBeenCalledWith(
    "/objects/cases",
    "PUT",
    expect.objectContaining({
      version: 3,
      config: expect.objectContaining({
        fields: expect.objectContaining({
          customer: expect.objectContaining({
            config: expect.objectContaining({
              pluginLookup: {
                collection: "people",
                labelField: "display_name",
                searchFields: ["tax_id"],
                idField: "customer_record_id",
              },
            }),
          }),
        }),
      }),
    }),
  );
});
it("surfaces a version conflict and preserves the form for retry", async () => {
  api.mockRejectedValue(new Error("Schema changed. Reload before saving."));
  render(
    <PluginLookupSettings
      object={source}
      objects={[source, target]}
      fields={["customer"]}
      onSaved={() => {}}
      onBack={() => {}}
    />,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Guardar configuración" }),
  );
  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent("Schema changed"),
  );
  expect(screen.getByLabelText("Campo del plugin")).toHaveValue("customer");
});
