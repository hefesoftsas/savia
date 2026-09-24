// @vitest-environment jsdom
import React, { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { memoryStore, StoreContextProvider, useLocaleState } from "ra-core";
import { AppLocaleProvider } from "@/i18n/app-locale-provider";
import { FormColumnPicker } from "../form-layout-picker";
import { FormLabelsEditor } from "../form-labels-editor";
import { getLocalizedFieldTypePalette } from "../field-type-icons";
import type { StudioObject } from "@savia/studio-shared/metadata";

afterEach(cleanup);
function LanguageButtons() {
  const [, setLocale] = useLocaleState();
  return (
    <>
      {["es", "en", "pt"].map((locale) => (
        <button key={locale} onClick={() => setLocale(locale)}>
          {locale}
        </button>
      ))}
    </>
  );
}
function Localized({ children }: { children: React.ReactNode }) {
  return (
    <StoreContextProvider value={memoryStore({ locale: "es" })}>
      <AppLocaleProvider>
        <LanguageButtons />
        {children}
      </AppLocaleProvider>
    </StoreContextProvider>
  );
}
it("switches layout captions without changing the selected column value", async () => {
  const onChange = vi.fn();
  render(
    <Localized>
      <FormColumnPicker value={2} onChange={onChange} />
    </Localized>,
  );
  expect(screen.getByRole("radio", { name: "Dos columnas" })).toBeChecked();
  fireEvent.click(screen.getByRole("button", { name: "en" }));
  expect(
    await screen.findByRole("radio", { name: "Two columns" }),
  ).toBeChecked();
  fireEvent.click(screen.getByRole("button", { name: "pt" }));
  expect(
    await screen.findByRole("radio", { name: "Duas colunas" }),
  ).toBeChecked();
  expect(onChange).not.toHaveBeenCalled();
});
it("preserves a user-authored label draft through language switching", async () => {
  function Editor() {
    const [fields, setFields] = useState<StudioObject["config"]["fields"]>({
      account_name: { type: "Textbox", label: "Customer-defined name" },
    });
    return <FormLabelsEditor fields={fields} onChange={setFields} />;
  }
  render(
    <Localized>
      <Editor />
    </Localized>,
  );
  fireEvent.change(
    screen.getByRole("textbox", { name: "Etiqueta de account_name" }),
    { target: { value: "My unsaved customer name" } },
  );
  fireEvent.click(screen.getByRole("button", { name: "en" }));
  expect(
    await screen.findByRole("textbox", { name: "Label for account_name" }),
  ).toHaveValue("My unsaved customer name");
  fireEvent.click(screen.getByRole("button", { name: "pt" }));
  expect(
    await screen.findByRole("textbox", { name: "Rótulo de account_name" }),
  ).toHaveValue("My unsaved customer name");
});
it("localizes palette captions while preserving field type contracts", () => {
  const es = getLocalizedFieldTypePalette("es");
  const en = getLocalizedFieldTypePalette("en");
  const pt = getLocalizedFieldTypePalette("pt");
  expect(en.map((item) => item.type)).toEqual(es.map((item) => item.type));
  expect(pt.map((item) => item.type)).toEqual(es.map((item) => item.type));
  expect(en.find((item) => item.type === "Textbox")?.label).toBe("Text");
  expect(pt.find((item) => item.type === "DateControl")?.label).toBe("Data");
});
