import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { buildQuoteComparisonPdf } from "../src/screens/quote-comparison-pdf";
import type { UnifiedComparisonQuote } from "../src/screens/unified-quote-model";

const coverage = {
  rce: "$4.000 millones",
  partialLossDeductible: "10% mín. 1 SMMLV",
  totalLossDeductible: "Sin deducible",
  replacementCar: "15 días",
  craneAssistance: "Ilimitada nacional",
  designatedDriver: "10 servicios / año",
  medicalExpenses: "Hasta $50M COP",
  legalAssistance: "Abogado presencial",
  workshop: "Talleres autorizados",
};

function quote(id: string, provider: string, premium: number): UnifiedComparisonQuote {
  return {
    id,
    productId: id,
    flowId: id,
    provider,
    productName: "Plan Integral",
    quoteNumber: `COT-${id}`,
    premium,
    monthlyInstallment: premium / 12,
    score: 9,
    badges: ["Todo riesgo"],
    coverages: coverage,
    highlights: [],
    ctaText: "",
    ctaSubtext: "",
    status: "succeeded",
  };
}

describe("buildQuoteComparisonPdf", () => {
  it("creates a PDF for the selected offers with the quote reference", async () => {
    const bytes = await buildQuoteComparisonPdf({
      quotes: [quote("liberty", "Liberty", 1448081), quote("equidad", "Equidad", 1220000)],
      quoteReference: "COT-20260917-NLEV",
      vehicleInfo: { plate: "REDACTD", declaredValue: 16000000 },
      createdAt: new Date("2026-09-17T12:00:00.000Z"),
    });

    const document = await PDFDocument.load(bytes);

    expect(document.getPageCount()).toBe(1);
    expect(document.getTitle()).toBe("Comparador de cotizaciones Savia");
  });
});
