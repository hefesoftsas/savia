import { describe, expect, it } from "vitest";
import { presentationInputSchema } from "../src/assistant/presentations";

describe("assistant presentation input", () => {
  it("accepts a finite series for a display-only chart", () => {
    const result = presentationInputSchema.safeParse({
      title: "Cotizaciones por día",
      visualization: {
        kind: "bar",
        valueLabel: "Cotizaciones",
        series: [
          { label: "Lun", value: 3 },
          { label: "Mar", value: 7 },
        ],
      },
    });

    expect(result.success).toBe(true);
  });

  it("rejects a table with rows that do not match its columns", () => {
    const result = presentationInputSchema.safeParse({
      title: "Ofertas",
      visualization: {
        kind: "table",
        columns: ["Aseguradora", "Valor"],
        rows: [["Savia"]],
      },
    });

    expect(result.success).toBe(false);
  });

  it("rejects non-finite values before they reach the UI", () => {
    const result = presentationInputSchema.safeParse({
      title: "Cotizaciones",
      visualization: {
        kind: "line",
        valueLabel: "Cotizaciones",
        series: [{ label: "Lun", value: Number.POSITIVE_INFINITY }],
      },
    });

    expect(result.success).toBe(false);
  });
});
