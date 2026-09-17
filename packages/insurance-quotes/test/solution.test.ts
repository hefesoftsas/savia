import { describe, expect, it } from "vitest";
import { insuranceQuotesExtensionManifest } from "../src/manifest";
import { insuranceSolution } from "../src/solution";

describe("insurance package release", () => {
  it("publishes the production quote wizard and its extension upgrade", () => {
    expect(insuranceSolution.version).toBe("1.5.0");
    expect(insuranceSolution.requires).toContain("insurance.quotes");
    expect(
      insuranceSolution.objects.some(
        (obj) => obj.name === "cotizaciones_detalle",
      ),
    ).toBe(true);
    expect(insuranceQuotesExtensionManifest.version).toBe("1.2.0");
  });

  it("hides data-only insurance screens and places package administration in Administración", () => {
    const quotation = insuranceSolution.objects.find(
      (object) => object.name === "cotizaciones",
    );
    const details = insuranceSolution.objects.find(
      (object) => object.name === "cotizaciones_detalle",
    );
    const administration = insuranceSolution.objects.find(
      (object) => object.name === "administrar_seguros",
    );

    expect(quotation?.config.studio?.screen?.hidden).toBe(true);
    expect(details?.config.studio?.screen?.hidden).toBe(true);
    expect(administration?.config.studio?.screen).toMatchObject({
      section: "administration",
      icon: "settings-2",
    });
  });
});
