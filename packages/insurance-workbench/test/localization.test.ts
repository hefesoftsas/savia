import { describe, expect, it } from "vitest";
import { money, dateLabel } from "../src/data";

describe("workbench locale formatting", () => {
  it("formats display currency and dates in the selected locale", () => {
    expect(money(1234.5, "en")).toBe(new Intl.NumberFormat("en-US", { style: "currency", currency: "COP", maximumFractionDigits: 2 }).format(1234.5));
    expect(dateLabel("2026-09-19", "pt")).toBe(new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" }).format(new Date("2026-09-19T00:00:00Z")));
    expect(money(null, "en")).toBe("No amount");
    expect(dateLabel(null, "pt")).toBe("Sem data");
  });
});
