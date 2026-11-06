import { describe, expect, it } from "vitest";
import { formatAmount, dateLabel } from "../src/data";

describe("generic workbench formatting", () => {
  it("formats amounts and dates in the selected locale", () => {
    expect(formatAmount(1234.5, "en")).toBe("1,234.5");
    expect(formatAmount(1234.5, "en", "USD")).toBe(
      new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 2,
      }).format(1234.5),
    );
    expect(dateLabel("2026-09-19", "pt")).toBe(
      new Intl.DateTimeFormat("pt-BR", {
        timeZone: "UTC",
        day: "numeric",
        month: "short",
        year: "numeric",
      }).format(new Date("2026-09-19T00:00:00Z")),
    );
    expect(formatAmount(null, "en")).toBe("No amount");
  });
});
