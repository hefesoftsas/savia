import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { StoreContextProvider, memoryStore } from "ra-core";
import { FormProvider, useForm } from "react-hook-form";
import { cloneElement, type ReactElement } from "react";
import { AppLocaleProvider } from "@/i18n/app-locale-provider";
import { MultiSelectField } from "../multi-select-field";
import { FieldValueDisplay } from "../field-value-display";
import { RichTextField } from "../rich-text-field";
import { registry } from "../fields";
import { fieldSchema } from "@savia/studio-shared/metadata";

afterEach(cleanup);
it("preserves translated option captions through schema parsing and stores only stable values", () => {
  const change = vi.fn();
  const field = fieldSchema.parse({
    type: "MultiSelect",
    label: "Custom label",
    options: [
      {
        value: "accepted",
        label: "Aceptado",
        labels: { en: "Accepted", pt: "Aceito" },
      },
    ],
  });
  const store = memoryStore({ locale: "es" });
  render(
    <StoreContextProvider value={store}>
      <AppLocaleProvider>
        <MultiSelectField
          fieldName="status"
          options={field.options}
          value={[]}
          setFieldValue={change}
        />
        <FieldValueDisplay field={field} value={["accepted"]} />
      </AppLocaleProvider>
    </StoreContextProvider>,
  );
  expect(screen.getByRole("checkbox", { name: "Aceptado" })).toBeVisible();
  act(() => store.setItem("locale", "en"));
  fireEvent.click(screen.getByRole("checkbox", { name: "Accepted" }));
  expect(change).toHaveBeenLastCalledWith("status", ["accepted"]);
  expect(screen.getAllByText("Accepted")).toHaveLength(2);
  act(() => store.setItem("locale", "pt"));
  expect(screen.getAllByText("Aceito")).toHaveLength(2);
  expect(field.options?.[0].value).toBe("accepted");
});
it("translates editor controls, accessible ratings and booleans without changing author text", () => {
  const store = memoryStore({ locale: "es" });
  render(
    <StoreContextProvider value={store}>
      <AppLocaleProvider>
        <RichTextField
          fieldName="description"
          value="Literal Save <b>text</b>"
        />
        <FieldValueDisplay
          field={{ type: "Rating", label: "Custom" }}
          value={3}
        />
        <FieldValueDisplay
          field={{ type: "Toggle", label: "Active" }}
          value={false}
        />
      </AppLocaleProvider>
    </StoreContextProvider>,
  );
  expect(screen.getByRole("button", { name: "Negrita" })).toBeVisible();
  act(() => store.setItem("locale", "en"));
  expect(screen.getByRole("button", { name: "Bold" })).toBeVisible();
  expect(screen.getByRole("img", { name: "3 of 5" })).toBeVisible();
  act(() => store.setItem("locale", "pt"));
  expect(screen.getByRole("button", { name: "Negrito" })).toBeVisible();
  expect(screen.getByRole("img", { name: "3 de 5" })).toBeVisible();
  expect(screen.getByText("Não")).toBeVisible();
  expect(screen.getByRole("textbox")).toHaveValue("Literal Save <b>text</b>");
});
it("keeps the editing locale while a currency draft is focused and formats the committed value in the new locale", () => {
  const store = memoryStore({ locale: "en" }),
    changed = vi.fn();
  function Currency() {
    const form = useForm({ defaultValues: { amount: 1234.5 } });
    return (
      <FormProvider {...form}>
        <label id="amount_label">Amount</label>
        {cloneElement(registry.Currency as ReactElement<any>, {
          fieldName: "amount",
          value: form.watch("amount"),
          config: { currency: "EUR", decimals: 2 },
          setFieldValue: (name: "amount", value: number) => {
            changed(name, value);
            form.setValue(name, value);
          },
        })}
      </FormProvider>
    );
  }
  render(
    <StoreContextProvider value={store}>
      <AppLocaleProvider>
        <Currency />
      </AppLocaleProvider>
    </StoreContextProvider>,
  );
  const input = screen.getByRole("textbox", { name: "Amount" });
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: "2,345.67" } });
  act(() => store.setItem("locale", "pt"));
  expect(input).toHaveValue("2,345.67");
  fireEvent.blur(input);
  expect(changed).toHaveBeenLastCalledWith("amount", 2345.67);
  expect(input).toHaveValue("2.345,67");
  expect(screen.getByText("€")).toBeVisible();
});

it("renders existing nonstandard currency codes without crashing", () => {
  function Currency() {
    const form = useForm({ defaultValues: { amount: 42 } });
    return (
      <FormProvider {...form}>
        <label id="amount_label">Amount</label>
        {cloneElement(registry.Currency as ReactElement<any>, {
          fieldName: "amount",
          value: 42,
          config: { currency: "USDT", decimals: 2 },
        })}
      </FormProvider>
    );
  }
  render(<Currency />);
  expect(screen.getByRole("textbox", { name: "Amount" })).toHaveValue("42.00");
  expect(screen.getAllByText("USDT")).toHaveLength(2);
});
