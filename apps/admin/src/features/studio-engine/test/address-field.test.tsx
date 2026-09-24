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
import { makeConfig, type StudioObject } from "@savia/studio-shared/metadata";

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
  vi.restoreAllMocks();
});

it("loads address suggestions when autocomplete is enabled", async () => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes("/api/geocoding/search")) {
      return new Response(
        JSON.stringify({
          data: [
            {
              label: "Carrera 7 # 45-67, Bogotá, Colombia",
              value: "Carrera 7 # 45-67, Bogotá, Colombia",
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response(JSON.stringify({ error: "unexpected" }), {
      status: 404,
    });
  });

  const object: StudioObject = {
    name: "locations",
    label: "Ubicaciones",
    description: "",
    config: makeConfig({
      address: {
        type: "Address",
        label: "Dirección",
        config: {
          addressAutocomplete: { provider: "photon", country: "co" },
        },
      },
    }),
  };

  render(
    <QueryClientProvider client={new QueryClient()}>
      <DynamicForm object={object} onSave={vi.fn()} />
    </QueryClientProvider>,
  );

  const input = screen.getByRole("combobox", { name: "Dirección" });
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: "Carrera 7" } });

  await waitFor(() =>
    expect(
      screen.getByRole("option", {
        name: "Carrera 7 # 45-67, Bogotá, Colombia",
      }),
    ).toBeTruthy(),
  );

  fireEvent.click(
    screen.getByRole("option", {
      name: "Carrera 7 # 45-67, Bogotá, Colombia",
    }),
  );

  expect((input as HTMLInputElement).value).toBe(
    "Carrera 7 # 45-67, Bogotá, Colombia",
  );
});
