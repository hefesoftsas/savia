import { describe, expect, it, vi } from "vitest";
import { createCrmApp } from "../src/index";

const app = createCrmApp();
const env = {
  POC_LOCAL: "true",
  DB: {
    prepare: () => ({
      first: async () => null,
      run: async () => ({}),
      bind: () => ({
        first: async () => null,
        run: async () => ({}),
      }),
    }),
  },
  FILES: {},
} as any;

describe("geocoding api", () => {
  it("returns formatted suggestions from the configured provider", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          features: [
            {
              properties: {
                housenumber: "10",
                street: "Calle 100",
                city: "Bogotá",
                country: "Colombia",
                countrycode: "CO",
              },
            },
          ],
        }),
      })),
    );

    const response = await app.request(
      "http://localhost/api/geocoding/search?q=calle%20100&provider=photon&country=co",
      { method: "GET" },
      env,
    );
    const payload: any = await response.json();

    expect(response.status).toBe(200);
    expect(payload.data).toEqual([
      {
        label: "10 Calle 100, Bogotá, Colombia",
        value: "10 Calle 100, Bogotá, Colombia",
      },
    ]);
  });

  it("requires server configuration for geoapify", async () => {
    const response = await app.request(
      "http://localhost/api/geocoding/search?q=calle%20100&provider=geoapify",
      { method: "GET" },
      env,
    );
    expect(response.status).toBe(503);
  });

  it("returns a reverse geocoded address", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          features: [
            {
              properties: {
                housenumber: "45",
                street: "Carrera 7",
                city: "Bogotá",
                country: "Colombia",
              },
            },
          ],
        }),
      })),
    );

    const response = await app.request(
      "http://localhost/api/geocoding/reverse?lat=4.651&lng=-74.083&provider=photon",
      { method: "GET" },
      env,
    );
    const payload: any = await response.json();

    expect(response.status).toBe(200);
    expect(payload.data.label).toContain("Carrera 7");
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

    const response = await app.request(
      "http://localhost/api/geocoding/approximate",
      { method: "GET" },
      env,
    );
    const payload: any = await response.json();

    expect(response.status).toBe(200);
    expect(payload.data).toMatchObject({
      lat: 4.65,
      lng: -74.08,
      source: "network",
    });
  });
});
