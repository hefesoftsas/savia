import { expect, it } from "vitest";
import { quoteProgressText } from "../src/whatsapp/quote-progress";

it("reports the product price and verified quote number without declaring a final winner", () => {
  const text = quoteProgressText({
    productId: "auto",
    provider: "Carrier",
    product: "Carrier · Auto",
    state: "priced",
    premium: 123456,
    quoteNumber: "Q-42",
    reference: "COT-1",
    quoteId: "quote-1",
  });
  expect(text).toContain("Carrier · Auto");
  expect(text).toContain("123.456");
  expect(text).toContain("Q-42");
  expect(text).toContain("COT-1");
  expect(text).not.toMatch(/mejor|menor|cobertura/i);
});

it("distinguishes unpriced and unverified responses without invented premiums", () => {
  const base = {
    productId: "auto",
    provider: "Carrier",
    product: "Auto",
    reference: "COT-1",
    quoteId: "quote-1",
  };
  expect(quoteProgressText({ ...base, state: "unpriced" })).toContain(
    "sin precio",
  );
  const uncertain = quoteProgressText({ ...base, state: "uncertain" });
  expect(uncertain).toContain("sin resultado verificado");
  expect(uncertain).not.toContain("$");
});
