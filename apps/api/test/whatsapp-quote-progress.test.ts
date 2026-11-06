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

it("includes verified coverage limits and deductibles even without model analysis", () => {
  const text = quoteProgressText({
    productId: "basic",
    provider: "Carrier",
    product: "Carrier · Basic",
    state: "priced",
    premium: 1591272,
    reference: "COT-internal",
    quoteId: "internal",
    facts: [
      {
        label: "Responsabilidad civil",
        value: "Capital informado: $4.400.000.000 COP; deducible: 0%",
        source: "provider",
      },
      {
        label: "Pérdida parcial",
        value: "Capital informado: $32.400.000 COP; deducible: 1 SMLV",
        source: "provider",
      },
    ],
  });
  expect(text).toContain("Responsabilidad civil");
  expect(text).toContain("$4.400.000.000 COP; deducible: 0%");
  expect(text).toContain("Pérdida parcial");
  expect(text).toContain("deducible: 1 SMLV");
  expect(text).not.toContain("COT-internal");
});

it("bounds detailed offer messages and points to the complete public report", () => {
  const text = quoteProgressText({
    productId: "basic",
    provider: "Carrier",
    product: "Carrier · Basic",
    state: "priced",
    premium: 1591272,
    reference: "internal",
    quoteId: "internal",
    facts: Array.from({ length: 24 }, (_, index) => ({
      label: `Coverage ${index + 1}`,
      value: "Verified limit and deductible ".repeat(7),
      source: "provider" as const,
    })),
  });
  expect(text).toContain("Coverage 1");
  expect(text).not.toContain("Coverage 24:");
  expect(text).toContain("enlace de la cotización");
  expect(text.length).toBeLessThanOrEqual(2000);
});

it("keeps zero deductibles and excludes unverified or unsafe evidence", () => {
  const text = quoteProgressText({
    productId: "basic",
    provider: "Carrier",
    product: "Basic",
    state: "priced",
    premium: 100,
    reference: "internal",
    quoteId: "internal",
    facts: [
      { label: "Deductible", value: "0%", source: "saved_verified" },
      { label: "Contact", value: "person@example.test", source: "provider" },
      { label: "Unknown", value: "<script>bad</script>", source: "provider" },
    ],
  });
  expect(text).toContain("Deductible: 0%");
  expect(text).not.toContain("person@example.test");
  expect(text).not.toContain("<script>");
});
