import { describe, expect, it } from "vitest";
import {
  insurancePortfolioWidgets,
  InsurancePortfolioSummaryWidget,
} from "../src/widgets";
import { insurancePortfolioExtensionManifest } from "../src/manifest";

describe("insurance portfolio widgets", () => {
  it("contributes a summary widget for polizas", () => {
    expect(insurancePortfolioWidgets).toHaveLength(1);
    expect(insurancePortfolioWidgets[0]).toMatchObject({
      id: "summary",
      extensionId: insurancePortfolioExtensionManifest.id,
      collection: "polizas",
      title: { es: "Resumen de cartera" },
    });
    expect(typeof insurancePortfolioWidgets[0]?.Widget).toBe("function");
    expect(insurancePortfolioWidgets[0]?.Widget).toBe(
      InsurancePortfolioSummaryWidget,
    );
  });

  it("uses a kind compatible with the My Day plugin pattern", () => {
    const entry = insurancePortfolioWidgets[0];
    const kind = `plugin:${entry?.extensionId}:${entry?.id}`;
    expect(kind).toMatch(/^plugin:[a-z0-9_.-]{1,64}:[a-z0-9_-]{1,64}$/);
  });
});
