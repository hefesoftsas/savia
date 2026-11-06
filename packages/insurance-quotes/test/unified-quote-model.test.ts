import { expect, it } from "vitest";
import { toUnifiedComparisonQuote } from "../src/screens/unified-quote-model";

it("does not invent a premium, ranking or coverage for live provider responses", () => {
  const quote = toUnifiedComparisonQuote({
    productId: "liberty-full",
    flowId: "liberty-full-quote",
    label: "Liberty · Full",
    provider: "Liberty",
    status: "succeeded",
    quoteNumber: "REAL-123",
  });
  expect(quote.premium).toBe(0);
  expect(quote.score).toBe(0);
  expect(quote.productName).toBe("Full");
  expect(Object.values(quote.coverages)).toEqual(
    expect.arrayContaining(["No informado por la aseguradora"]),
  );
  expect(quote.highlights).toEqual(["Cotización: REAL-123"]);
});

it("keeps the actual premium returned by the live insurer", () => {
  const quote = toUnifiedComparisonQuote({
    productId: "liberty-full",
    flowId: "liberty-full-quote",
    label: "Liberty · Full",
    provider: "Liberty",
    status: "succeeded",
    quoteNumber: "REAL-123",
    premium: 1448081,
  });
  expect(quote.premium).toBe(1448081);
});

it("renders persisted snapshots without needing recent runs", () => {
  const quote = toUnifiedComparisonQuote(
    {
      productId: "sbs-producto-10",
      flowId: "sbs-producto-10",
      label: "SBS Seguros · Plan Gold Premium",
      provider: "SBS Seguros",
      status: "succeeded",
      quoteNumber: "SIM-1",
      premium: 1250000,
      snapshot: {
        provider: "SBS Seguros",
        productName: "Plan Gold Premium",
        premium: 1250000,
        quoteNumber: "SIM-1",
        monthlyInstallment: 104167,
        score: 9.6,
        badges: ["Todo Riesgo"],
        coverages: {
          rce: "$4.000.000.000 COP",
          partialLossDeductible: "10% mín. 1 SMMLV",
          totalLossDeductible: "0% (Sin Deducible)",
          replacementCar: "15 días continuos",
          craneAssistance: "Ilimitada Nacional",
          designatedDriver: "12 servicios / año",
          medicalExpenses: "Hasta $60M COP",
          legalAssistance: "Abogado presencial / Ilimitada",
          workshop: "Taller concesionario oficial Chevrolet",
        },
        highlights: ["Responsabilidad Civil: $4.000 Millones"],
      },
    },
    undefined,
  );
  expect(quote.premium).toBe(1250000);
  expect(quote.productName).toBe("Plan Gold Premium");
  expect(quote.coverages.rce).toBe("$4.000.000.000 COP");
  expect(quote.badges).toEqual(["Todo Riesgo"]);
});
