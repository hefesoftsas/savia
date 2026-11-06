import { describe, expect, it } from "vitest";
import { configSchema } from "../src/metadata";
import {
  displayTextVariantLabels,
  renderDisplayTextContent,
  resolveDisplayText,
} from "../src/display-text";

describe("display text field", () => {
  it("renders template content for presentation fields", () => {
    expect(
      renderDisplayTextContent("Hola {{values.nombre}}", {
        values: { nombre: "Ana" },
      }),
    ).toBe("Hola Ana");
  });

  it("validates metadata for DisplayText fields", () => {
    const parsed = configSchema.safeParse({
      version: 2,
      fields: {
        saludo: {
          type: "DisplayText",
          label: "Saludo",
          readOnly: true,
          config: {
            displayText: {
              variant: "title",
              content: "Hola {{values.nombre}}",
            },
          },
        },
        nombre: { type: "Textbox", label: "Nombre" },
      },
      fieldOrder: ["saludo", "nombre"],
    });
    if (!parsed.success) {
      throw new Error(parsed.error.issues.map((issue) => issue.message).join("; "));
    }
    expect(parsed.success).toBe(true);
    expect(displayTextVariantLabels.title).toBe("Título");
    expect(
      resolveDisplayText({
        displayText: { variant: "span", content: "Texto" },
      }),
    ).toEqual({ variant: "span", content: "Texto", align: undefined });
  });
});
