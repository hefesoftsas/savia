import { expect, it } from "vitest";
import { quoteProgressText } from "../src/whatsapp/quote-progress";

it("reports only the priced product and premium without internal quote identifiers", () => {
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
  expect(text).not.toContain("Q-42");
  expect(text).not.toContain("COT-1");
  expect(text).not.toContain("quote-1");
  expect(text).not.toMatch(/resumen final|mejor|menor|cobertura/i);
});

it("emits no customer progress for unpriced, failed, uncertain, or invalid-premium results", () => {
  const base = {
    productId: "auto",
    provider: "Carrier",
    product: "Auto",
    reference: "COT-1",
    quoteId: "quote-1",
  };
  expect(quoteProgressText({ ...base, state: "unpriced" })).toBe("");
  expect(quoteProgressText({ ...base, state: "failed" })).toBe("");
  expect(quoteProgressText({ ...base, state: "uncertain" })).toBe("");
  expect(quoteProgressText({ ...base, state: "priced" })).toBe("");
  expect(quoteProgressText({ ...base, state: "priced", premium: 0 })).toBe("");
  expect(quoteProgressText({ ...base, state: "priced", premium: -100 })).toBe(
    "",
  );
  expect(
    quoteProgressText({ ...base, state: "priced", premium: Number.NaN }),
  ).toBe("");
});
