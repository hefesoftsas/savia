import { expect, it } from "vitest";
import { actionResultText } from "../src/whatsapp/action-results";

it("directs a quote with no priced offers to the configured human contact", () => {
  const text = actionResultText(
    "Alice",
    "quote-auto",
    {
      state: "completed",
      result: {
        reference: "COT-test",
        pricedOffers: 0,
        failedOffers: 1,
        lowestPriceOffers: [],
      },
    },
    "https://support.example.test/help",
  );
  expect(text).toContain("No recibí ofertas con precio");
  expect(text).toContain("https://support.example.test/help");
});

it.each(["failed", "uncertain"] as const)(
  "directs %s actions to configured human support without claiming completion",
  (state) => {
    const text = actionResultText(
      "Alice",
      "quote-auto",
      { state, message: "No pude verificar el resultado." },
      "https://support.example.test/help",
    );
    expect(text).toContain("No pude verificar el resultado.");
    expect(text).toContain(
      "contactar directamente a un asesor en https://support.example.test/help",
    );
    expect(text).not.toContain("Solicitud completada");
  },
);
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
