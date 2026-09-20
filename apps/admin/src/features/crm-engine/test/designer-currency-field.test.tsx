// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { render } from "./studio-test-render";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Designer from "../designer";
import { makeConfig, type CrmObject } from "@savia/crm-shared/metadata";
import DynamicForm from "../dynamic-form";

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/objects")) {
        return new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "unexpected" }), {
        status: 404,
      });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("offers Currency (Moneda) from the designer palette and configures properties", async () => {
  const object: CrmObject = {
    name: "opportunities",
    label: "Oportunidades",
    description: "",
    config: makeConfig({ name: { type: "Textbox", label: "Nombre" } }),
  };

  render(
    <QueryClientProvider client={new QueryClient()}>
      <Designer object={object} onSaved={vi.fn()} />
    </QueryClientProvider>,
  );

  // 1. Check Moneda button in palette
  const monedaButton = screen.getByRole("button", { name: "Moneda" });
  expect(monedaButton).toBeInTheDocument();

  // 2. Palette search by searchTerms ("dinero", "precio", "moneda")
  const searchInput = screen.getByPlaceholderText("texto, número, fecha…");
  fireEvent.change(searchInput, { target: { value: "precio" } });
  expect(screen.getByRole("button", { name: "Moneda" })).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Fecha" }),
  ).not.toBeInTheDocument();

  // Clear search
  fireEvent.change(searchInput, { target: { value: "" } });

  // 3. Click Moneda to add it
  fireEvent.click(screen.getByRole("button", { name: "Moneda" }));
  expect(screen.getAllByText("Moneda").length).toBeGreaterThan(1);

  // 4. Properties panel shows Moneda badge, currency options, and decimals
  expect(screen.getByText("Propiedades del campo")).toBeInTheDocument();
  expect(screen.getByLabelText("Moneda")).toBeInTheDocument();
  expect(screen.getByText("COP ($)")).toBeInTheDocument();
  expect(screen.getByLabelText("Decimales")).toBeInTheDocument();
  expect((screen.getByLabelText("Decimales") as HTMLSelectElement).value).toBe(
    "2",
  );

  // Change currency to USD and decimals to 0
  fireEvent.change(screen.getByLabelText("Moneda"), {
    target: { value: "USD" },
  });
  expect((screen.getByLabelText("Moneda") as HTMLSelectElement).value).toBe(
    "USD",
  );

  fireEvent.change(screen.getByLabelText("Decimales"), {
    target: { value: "0" },
  });
  expect((screen.getByLabelText("Decimales") as HTMLSelectElement).value).toBe(
    "0",
  );
});

it("renders CurrencyField with $ prefix, currency badge and formats decimals in preview form", () => {
  const object: CrmObject = {
    name: "quotes",
    label: "Cotizaciones",
    description: "",
    config: makeConfig({
      amount: {
        type: "Currency",
        label: "Monto cotizado",
        config: { currency: "USD", decimals: 2 },
      },
    }),
  };

  render(
    <QueryClientProvider client={new QueryClient()}>
      <DynamicForm object={object} onSubmit={vi.fn()} />
    </QueryClientProvider>,
  );

  expect(screen.getByText("Monto cotizado")).toBeInTheDocument();
  const prefix = screen.getByText(
    new Intl.NumberFormat("es-CO", { style: "currency", currency: "USD" })
      .formatToParts(0)
      .find((part) => part.type === "currency")!.value,
  );
  expect(prefix).toBeInTheDocument();
  expect(screen.getByText("USD")).toBeInTheDocument();
  const input = screen.getByLabelText("Monto cotizado");
  expect(prefix.nextElementSibling).toBe(input);
  expect(input).toHaveAttribute("type", "text");
  expect(input).toHaveAttribute("inputmode", "decimal");
  expect(input).toHaveAttribute("placeholder", "0,00");

  // Type value and blur to verify formatted decimals
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: "1500,5" } });
  fireEvent.blur(input);
  expect((input as HTMLInputElement).value).toBe("1.500,50");
});
