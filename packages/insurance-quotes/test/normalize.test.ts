import { describe, expect, it } from "vitest";
import {
  normalizeInsuranceAction,
  normalizeInsurerQuote,
} from "../src/normalize";

describe("insurance quote normalization", () => {
  it("normalizes the Sura plate lookup as a vehicle without leaking secrets", () => {
    expect(
      normalizeInsuranceAction("sura", "sura-vehicle-by-plate", {
        placa: "testcar",
        modelo: "2024",
        fasecolda: "04408010",
        motor: "M-1",
        chasis: "C-1",
        valorAsegurado: "45000000",
        valorAccesorios: "1200000",
        apiKey: "hidden",
      }),
    ).toEqual({
      type: "vehicle_lookup",
      provider: "sura",
      status: "success",
      data: {
        vehicle: {
          plate: "TESTCAR",
          productionYear: 2024,
          fasecoldaCode: "04408010",
          engineNumber: "M-1",
          chassisNumber: "C-1",
          declaredValue: 45000000,
          accessoriesValue: 1200000,
          currency: "COP",
        },
      },
    });
  });

  it("keeps the quote payload useful while redacting sensitive fields", () => {
    expect(
      normalizeInsurerQuote("sura", {
        quoteNumber: "Q-100",
        premiumTotal: 245000,
        nested: { authorization: "hidden", coverage: "full" },
      }),
    ).toEqual({
      type: "quote",
      provider: "sura",
      status: "success",
      data: {
        quoteNumber: "Q-100",
        premiumTotal: 245000,
        nested: { coverage: "full" },
      },
    });
  });
});
