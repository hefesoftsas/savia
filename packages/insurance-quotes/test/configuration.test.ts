import { describe, expect, it } from "vitest";
import {
  defaultInsurancePackageSettings,
  insuranceQuoteProductCatalog,
  mergeInsuranceSettings,
} from "../src/configuration";

describe("insurance quote package configuration", () => {
  it("ships both quote pages and all nineteen bundle products enabled by default", () => {
    expect(defaultInsurancePackageSettings).toMatchObject({
      quotePages: { direct: true, wizard: true },
      vehicleLookup: { enabled: true, flowId: "sura-autos-provider" },
    });
    expect(insuranceQuoteProductCatalog).toHaveLength(19);
    expect(defaultInsurancePackageSettings.products).toHaveLength(19);
    expect(defaultInsurancePackageSettings.products).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "equidad-basico-quote",
          enabled: true,
        }),
        expect.objectContaining({
          id: "liberty-integral-quote",
          enabled: true,
        }),
        expect.objectContaining({
          id: "qualitas-plus-quote",
          enabled: true,
        }),
        expect.objectContaining({
          id: "previsora-clasica-quote",
          enabled: true,
        }),
      ]),
    );
  });

  it("migrates legacy SBS choices and enables newly shipped bundle products", () => {
    const merged = mergeInsuranceSettings({
      quotePages: { direct: false, wizard: true },
      vehicleLookup: { enabled: true, connectionId: "sura" },
      products: [
        {
          id: "sbs-product-8",
          label: "Custom label ignored",
          enabled: true,
          rank: 20,
          connectionId: "sbs-main",
        },
      ],
    });

    expect(merged).toMatchObject({
      quotePages: { direct: false, wizard: true },
      vehicleLookup: { enabled: true, flowId: "sura-autos-provider" },
    });
    expect(merged.products).toHaveLength(19);
    expect(merged.products).toEqual(
      expect.arrayContaining([
        {
          id: "sbs-producto-8",
          label: "SBS · Autos Producto 8",
          enabled: true,
          rank: 20,
        },
        expect.objectContaining({
          id: "equidad-full-quote",
          enabled: true,
        }),
      ]),
    );
  });
});
