// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { render } from "./studio-test-render";
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

it("offers Archivo adjunto from the designer palette", () => {
  const object: CrmObject = {
    name: "contracts",
    label: "Contratos",
    description: "",
    config: makeConfig({ name: { type: "Textbox", label: "Nombre" } }),
  };
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Designer object={object} onSaved={vi.fn()} />
    </QueryClientProvider>,
  );

  const add = screen.getByRole("button", { name: "Archivo adjunto" });
  fireEvent.click(add);

  expect(screen.getAllByText("Archivo adjunto").length).toBeGreaterThan(1);
  expect(screen.getByText("Archivos en R2")).toBeTruthy();
  expect(screen.getByLabelText("Máximo de archivos")).toBeTruthy();
  expect(screen.getByLabelText("Tamaño máximo (MiB)")).toBeTruthy();
  expect(screen.getByLabelText("Tipos MIME permitidos")).toBeTruthy();
});
