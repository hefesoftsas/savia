import { describe, expect, it } from "vitest";
import {
  resolveAddressAutocomplete,
  searchAddressSuggestions,
} from "../src/address-autocomplete";

describe("address autocomplete", () => {
  it("resolves optional settings from field config", () => {
    expect(resolveAddressAutocomplete(undefined)).toBeNull();
    expect(resolveAddressAutocomplete({})).toBeNull();
    expect(resolveAddressAutocomplete({ addressAutocomplete: true })).toEqual({
      provider: "photon",
      language: "es",
    });
    expect(
      resolveAddressAutocomplete({
        addressAutocomplete: { provider: "nominatim", country: "CO" },
      }),
    ).toEqual({
      provider: "nominatim",
      country: "co",
      language: "es",
    });
  });

  it("formats photon results and filters by country", async () => {
    const fetchImpl = async () =>
      ({
        ok: true,
        json: async () => ({
          features: [
            {
              properties: {
                housenumber: "45",
                street: "Carrera 7",
                city: "Bogotá",
                country: "Colombia",
                countrycode: "CO",
              },
            },
            {
              properties: {
                street: "Main Street",
                city: "Austin",
                country: "United States",
                countrycode: "US",
              },
            },
          ],
        }),
      }) as Response;

    await expect(
      searchAddressSuggestions(
        "carrera 7",
        { provider: "photon", country: "co", language: "es" },
        { fetchImpl },
      ),
    ).resolves.toEqual([
      {
        label: "45 Carrera 7, Bogotá, Colombia",
        value: "45 Carrera 7, Bogotá, Colombia",
      },
    ]);
  });
});
