// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Designer from "../designer";
import { makeConfig, type CrmObject } from "@savia/crm-shared/metadata";

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

it("offers Autocompletar from the designer palette", () => {
  const object: CrmObject = {
    name: "locations",
    label: "Ubicaciones",
    description: "",
    config: makeConfig({ name: { type: "Textbox", label: "Nombre" } }),
  };
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Designer object={object} onSaved={vi.fn()} />
    </QueryClientProvider>,
  );

  fireEvent.click(screen.getByRole("button", { name: "Autocompletar" }));

  expect(screen.getAllByText("Autocompletar").length).toBeGreaterThan(1);
  expect(
    screen.getByLabelText("Opciones (valor | etiqueta, una por línea)"),
  ).toBeTruthy();
});
