// @vitest-environment jsdom
import React, { useState } from "react";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { render } from "./studio-test-render";
import {
  StaticOptionLabelsEditor,
  parseStaticOptions,
} from "../designer-option-labels";
afterEach(cleanup);
it("edits a translated option caption without changing its stored value or primary label", () => {
  let result = [
    { value: "active", label: "Activo", labels: { en: "Active", pt: "Ativo" } },
  ];
  function Editor() {
    const [options, setOptions] = useState(result);
    return (
      <StaticOptionLabelsEditor
        options={options}
        onChange={(next) => {
          result = next as typeof result;
          setOptions(result);
        }}
      />
    );
  }
  render(<Editor />);
  fireEvent.click(screen.getByText("Traducciones de opciones"));
  fireEvent.click(screen.getByRole("tab", { name: "EN" }));
  fireEvent.change(screen.getByRole("tabpanel", { name: "Etiqueta EN" }), {
    target: { value: "Enabled" },
  });
  expect(result).toEqual([
    {
      value: "active",
      label: "Activo",
      labels: { en: "Enabled", pt: "Ativo" },
    },
  ]);
});
it("retains translations for unchanged option values when the base list is edited", () => {
  expect(
    parseStaticOptions("active | Vigente\nnew | Nuevo", [
      {
        value: "active",
        label: "Activo",
        labels: { en: "Active", pt: "Ativo" },
      },
    ]),
  ).toEqual([
    {
      value: "active",
      label: "Vigente",
      labels: { en: "Active", pt: "Ativo" },
    },
    { value: "new", label: "Nuevo" },
  ]);
});

it("preserves numeric option values while editing their captions", () => {
  expect(
    parseStaticOptions("7 | Updated", [
      { value: 7, label: "Original", labels: { en: "Original" } },
    ]),
  ).toEqual([{ value: 7, label: "Updated", labels: { en: "Original" } }]);
});
