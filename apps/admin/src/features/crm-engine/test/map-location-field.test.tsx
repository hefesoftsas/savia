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
import { makeConfig, type CrmObject } from "@savia/crm-shared/metadata";

const mapClick = vi.fn();
const markerDragEnd = vi.fn();

vi.mock("leaflet", () => {
  const marker = {
    addTo: vi.fn().mockReturnThis(),
    on: vi.fn(function (this: typeof marker, event: string, handler: () => void) {
      if (event === "dragend") markerDragEnd.mockImplementation(handler);
      return this;
    }),
    setLatLng: vi.fn().mockReturnThis(),
    bindPopup: vi.fn().mockReturnThis(),
    getLatLng: vi.fn(() => ({ lat: 4.651, lng: -74.083 })),
  };
  const map = {
    setView: vi.fn(),
    fitBounds: vi.fn(),
    getZoom: vi.fn(() => 14),
    on: vi.fn(function (this: typeof map, event: string, handler: (event: { latlng: { lat: number; lng: number } }) => void) {
      if (event === "click") mapClick.mockImplementation(handler);
      return this;
    }),
    remove: vi.fn(),
  };
  return {
    default: {
      map: vi.fn(() => map),
      tileLayer: vi.fn(() => ({ addTo: vi.fn() })),
      marker: vi.fn(() => marker),
      divIcon: vi.fn((options: unknown) => options),
      latLngBounds: vi.fn(() => ({ pad: vi.fn(() => ({})) })),
    },
  };
});

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
  mapClick.mockReset();
  markerDragEnd.mockReset();
});

it("loads address suggestions and moves the map marker", async () => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes("/api/geocoding/search")) {
      return new Response(
        JSON.stringify({
          data: [
            {
              label: "Carrera 7 # 45-67, Bogotá, Colombia",
              value: "Carrera 7 # 45-67, Bogotá, Colombia",
              lat: 4.651,
              lng: -74.083,
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (url.includes("/api/geocoding/reverse")) {
      return new Response(
        JSON.stringify({
          data: {
            label: "Carrera 7 # 45-67, Bogotá",
            address: "Carrera 7 # 45-67, Bogotá",
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response(JSON.stringify({ data: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });

  const object: CrmObject = {
    name: "visits",
    label: "Visitas",
    description: "",
    config: makeConfig({
      location: {
        type: "MapLocation",
        label: "Ubicación del cliente",
        config: {
          mapPicker: {
            geolocation: false,
            reverseGeocode: true,
          },
        },
      },
    }),
  };

  render(
    <QueryClientProvider client={new QueryClient()}>
      <DynamicForm object={object} onSave={vi.fn()} />
    </QueryClientProvider>,
  );

  const input = screen.getByPlaceholderText("Buscar dirección…");
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

  await waitFor(() =>
    expect((input as HTMLInputElement).value).toBe(
      "Carrera 7 # 45-67, Bogotá, Colombia",
    ),
  );
});

it("stores coordinates selected on the map", async () => {
  const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes("/api/geocoding/reverse")) {
      return new Response(
        JSON.stringify({
          data: {
            label: "Carrera 7 # 45-67, Bogotá",
            address: "Carrera 7 # 45-67, Bogotá",
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response(JSON.stringify({ data: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });

  const object: CrmObject = {
    name: "visits",
    label: "Visitas",
    description: "",
    config: makeConfig({
      location: {
        type: "MapLocation",
        label: "Ubicación del cliente",
        config: {
          mapPicker: {
            geolocation: false,
            reverseGeocode: true,
            reference: { lat: 4.6, lng: -74.08, label: "Centro de ventas" },
          },
        },
      },
    }),
  };

  render(
    <QueryClientProvider client={new QueryClient()}>
      <DynamicForm object={object} onSave={vi.fn()} />
    </QueryClientProvider>,
  );

  expect(screen.getByText(/Centro de ventas/)).toBeTruthy();

  mapClick({ latlng: { lat: 4.651, lng: -74.083 } });

  await waitFor(() =>
    expect(fetchMock.mock.calls.some(([url]) =>
      String(url).includes("/api/geocoding/reverse"),
    )).toBe(true),
  );
});
