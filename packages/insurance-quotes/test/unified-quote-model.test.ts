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
