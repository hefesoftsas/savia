import { expect, it } from "vitest";
import { extractProviderQuoteFacts } from "../src/provider-quote-facts";
import { insurancePublicQuoteContribution } from "../src/public-form";

it("preserves all returned amparos instead of losing coverages after the twentieth", () => {
  const amparo = Array.from({ length: 25 }, (_, index) => ({
    nombre: `Cobertura ${index}`,
    capital: 1000000,
    tdeducible: "0%",
  }));
  const facts = extractProviderQuoteFacts({ response: { amparo } });
  expect(facts).toHaveLength(25);
  expect(facts[24].label).toBe("Cobertura 24");
});

it("supports a canonical coverage breakdown independently of insurer identity", () => {
  expect(
    extractProviderQuoteFacts({
      coverageDetails: [{ label: "Daños", limit: 25000000, deductible: "10%" }],
    }),
  ).toEqual([
    {
      label: "Daños",
      value: "Capital informado: $25.000.000 COP; deducible: 10%",
      source: "provider",
    },
  ]);
});

it("does not turn simulated, malformed or private strings into verified facts", () => {
  expect(
    extractProviderQuoteFacts({
      simulated: true,
      coverages: { rce: "Example" },
    }),
  ).toEqual([]);
  const facts = extractProviderQuoteFacts({
    response: {
      amparo: [
        { nombre: "private@example.test", capital: 1000 },
        {
          nombre: "Daños",
          capital: Infinity,
          tdeducible: { document: "PRIVATE_DOCUMENT" },
        },
        { nombre: "Hurto", capital: -1 },
        {
          nombre: "Vidrios",
          capital: 20000,
          tdeducible: "https://private.test/secret",
        },
      ],
    },
    rawPayload: { applicantName: "Private" },
  });
  expect(facts).toEqual([
    {
      label: "Vidrios",
      value: "Capital informado: $20.000 COP; deducible no informado",
      source: "provider",
    },
  ]);
});

it("uses the same verified coverage details in the existing public form viewer", () => {
  const result = insurancePublicQuoteContribution.projectResult(
    "liberty-basico-quote",
    {
      data: {
        response: {
          datosEconomicos: { total: 1000 },
          amparo: [
            {
              nombre: "Pérdida Parcial por Daños",
              capital: 25000000,
              tdeducible: "1 SMLV",
            },
          ],
        },
      },
    },
  );
  expect(result.coverages).toEqual([
    "Pérdida Parcial por Daños: Capital informado: $25.000.000 COP; deducible: 1 SMLV",
  ]);
});
