import { expect, it } from "vitest";
import { actionResultText } from "../src/whatsapp/action-results";
it("summarizes actual saved offers and labels the originating employee", () => {
  const text = actionResultText("Alice", "quote-auto", {
    state: "completed",
    result: {
      reference: "COT-test",
      pricedOffers: 1,
      failedOffers: 2,
      lowestPriceOffers: [{ product: "Product", premium: 1500000 }],
      recommendation: "Faltan coberturas.",
    },
  });
  expect(text).toContain("Alice · Asistente virtual");
  expect(text).toContain("COT-test");
  expect(text).toContain("1.500.000");
  expect(text).toContain("2");
  expect(text).not.toContain("http");
});
