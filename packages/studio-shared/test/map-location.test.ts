import { describe, expect, it, vi } from "vitest";
import {
  formatMapLocationSummary,
  mapLocationCenter,
  parseMapLocation,
  requestCurrentLocation,
  resolveApproximateLocation,
  resolveMapPicker,
} from "../src/map-location";
import { makeConfig, objectSchema, validateRecord, type StudioObject } from "../src/metadata";

describe("map location helpers", () => {
  it("parses stored coordinates", () => {
    expect(parseMapLocation({ lat: 4.6, lng: -74.08, label: "Centro" })).toEqual({
      lat: 4.6,
      lng: -74.08,
      label: "Centro",
    });
    expect(parseMapLocation('{"lat":4.6,"lng":-74.08}')).toEqual({
      lat: 4.6,
      lng: -74.08,
    });
  });

  it("formats a readable summary", () => {
    expect(
      formatMapLocationSummary({
        lat: 4.6097,
        lng: -74.0817,
        address: "Carrera 7 # 45-67",
      }),
    ).toBe("Carrera 7 # 45-67");
  });

  it("uses reference point as map center", () => {
    expect(
      mapLocationCenter({
        reference: { lat: 10, lng: 20, label: "Tienda" },
      }),
    ).toEqual({ lat: 10, lng: 20 });
  });

  it("defaults map picker settings", () => {
    expect(resolveMapPicker(undefined)).toMatchObject({
      geolocation: true,
      reverseGeocode: true,
      zoom: 14,
      language: "es",
    });
  });

  it("returns approximate coordinates from ip lookup", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            status: "success",
            lat: 4.65,
            lon: -74.08,
            city: "Bogotá",
            country: "Colombia",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    await expect(resolveApproximateLocation()).resolves.toMatchObject({
      lat: 4.65,
      lng: -74.08,
      source: "network",
    });
  });

  it("falls back to approximate location when browser geolocation fails", async () => {
    vi.stubGlobal("navigator", {
      geolocation: {
        getCurrentPosition: (
          _success: PositionCallback,
          error: PositionErrorCallback,
        ) => error({ code: 3, message: "timeout" } as GeolocationPositionError),
        watchPosition: (
          _success: PositionCallback,
          error: PositionErrorCallback,
        ) => error({ code: 3, message: "timeout" } as GeolocationPositionError),
      },
      permissions: { query: vi.fn().mockResolvedValue({ state: "granted" }) },
    });
    vi.stubGlobal("window", { isSecureContext: true });

    await expect(
      requestCurrentLocation({
        approximate: async () => ({
          lat: 4.7,
          lng: -74.1,
          source: "network" as const,
        }),
      }),
    ).resolves.toMatchObject({
      approximate: true,
      coords: { latitude: 4.7, longitude: -74.1 },
    });
  });
});

describe("map location validation", () => {
  const object: StudioObject = {
    name: "visits",
    label: "Visitas",
    description: "",
    config: makeConfig({
      location: {
        type: "MapLocation",
        label: "Ubicación",
        required: true,
        config: {
          mapPicker: {
            geolocation: true,
            reverseGeocode: true,
            reference: { lat: 4.6, lng: -74.08, label: "Centro de ventas" },
          },
        },
      },
    }),
  };

  it("accepts valid coordinates", () => {
    expect(
      validateRecord(object, {
        location: { lat: 4.651, lng: -74.083, label: "Cliente" },
      }).errors,
    ).toEqual({});
  });

  it("rejects invalid coordinates", () => {
    expect(
      validateRecord(object, { location: { lat: "bad", lng: 1 } }).errors.location,
    ).toMatch(/válido/);
  });

  it("rejects map picker config outside MapLocation fields", () => {
    expect(
      objectSchema.safeParse({
        ...object,
        config: makeConfig({
          notes: {
            type: "Textbox",
            label: "Notas",
            config: { mapPicker: { zoom: 12 } },
          },
        }),
      }).success,
    ).toBe(false);
  });
});
