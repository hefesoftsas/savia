import { describe, expect, it } from "vitest";
import {
  isFieldLabelLocale,
  normalizeFieldLabels,
  resolveFieldLabel,
} from "../src/field-labels";
import { configSchema, makeConfig, objectSchema } from "../src/metadata";

describe("field labels", () => {
  it("resolves localized labels with Spanish fallback", () => {
    const field = {
      label: "Placa",
      labels: { en: "License plate", pt: "Placa" },
    };
    expect(resolveFieldLabel(field, "es")).toBe("Placa");
    expect(resolveFieldLabel(field, "en")).toBe("License plate");
    expect(resolveFieldLabel(field, "pt")).toBe("Placa");
  });

  it("falls back to the primary label when a translation is missing", () => {
    expect(
      resolveFieldLabel({ label: "Año del vehículo", labels: { en: "Model year" } }, "pt"),
    ).toBe("Año del vehículo");
  });

  it("normalizes empty translation entries", () => {
    expect(
      normalizeFieldLabels({ en: "  Year  ", pt: "   " }),
    ).toEqual({ en: "Year" });
  });

  it("accepts optional labels in object metadata", () => {
    const config = makeConfig({
      plate: {
        type: "Textbox",
        label: "Placa",
        labels: { en: "License plate" },
      },
    });
    expect(configSchema.safeParse(config).success).toBe(true);
    expect(
      objectSchema.safeParse({
        name: "vehicle",
        label: "Vehículos",
        description: "",
        config,
      }).success,
    ).toBe(true);
  });

  it("validates supported label locales", () => {
    expect(isFieldLabelLocale("es")).toBe(true);
    expect(isFieldLabelLocale("fr")).toBe(false);
  });
});
