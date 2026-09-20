import { describe, expect, it } from "vitest";
import { solutionPackageSchema } from "../src/solution-package";
import { objectSchema } from "../src/metadata";

const baseObject = {
  name: "clientes",
  label: "Clientes",
  description: "Personas y empresas aseguradas.",
  config: {
    version: 2,
    fields: {
      name: { type: "Textbox", label: "Nombre", required: true },
    },
    fieldOrder: ["name"],
  },
};

const basePackage = {
  format: "savia.solution",
  formatVersion: 1,
  id: "savia.insurance",
  version: "1.5.0",
  label: "Seguros",
  description: "Clientes y pólizas.",
  requires: [],
  objects: [baseObject],
};

describe("solution package localization", () => {
  it("keeps optional package and object translations with stable defaults", () => {
    const parsed = solutionPackageSchema.parse({
      ...basePackage,
      labels: { en: "Insurance" },
      descriptions: { pt: "Clientes e apólices." },
      objects: [
        {
          ...baseObject,
          labels: { en: "Customers", pt: "Clientes" },
          descriptions: { en: "Insured people." },
        },
      ],
    });
    expect(parsed.label).toBe("Seguros");
    expect(parsed.labels).toEqual({ en: "Insurance" });
    expect(parsed.objects[0].label).toBe("Clientes");
    expect(parsed.objects[0].labels).toEqual({
      en: "Customers",
      pt: "Clientes",
    });
  });

  it("accepts legacy packages without translations", () => {
    const parsed = solutionPackageSchema.parse(basePackage);
    expect(parsed.labels).toBeUndefined();
    expect(parsed.objects[0].labels).toBeUndefined();
  });

  it("rejects unknown locales and oversized translations", () => {
    expect(
      solutionPackageSchema.safeParse({
        ...basePackage,
        labels: { fr: "Assurance" },
      }).success,
    ).toBe(false);
    expect(
      objectSchema.safeParse({
        ...baseObject,
        descriptions: { en: "x".repeat(501) },
      }).success,
    ).toBe(false);
  });
});
