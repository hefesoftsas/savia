import { describe, expect, it } from "vitest";
import { getMessages } from "@/i18n/locales";

function saviaMessages(locale: "es" | "en" | "pt") {
  return getMessages(locale).savia as Record<string, unknown>;
}

describe("i18n messages", () => {
  it("loads Spanish, English, and Portuguese bundles", () => {
    expect(
      (saviaMessages("es").sidebar as Record<string, unknown>).items,
    ).toMatchObject({ integrations: "Integraciones" });
    expect(
      (saviaMessages("en").sidebar as Record<string, unknown>).items,
    ).toMatchObject({ integrations: "Integrations" });
    expect(
      (saviaMessages("pt").sidebar as Record<string, unknown>).items,
    ).toMatchObject({ integrations: "Integrações" });
  });

  it("translates react-admin navigation strings in Spanish", () => {
    expect(getMessages("es").ra.action.save).toBe("Guardar");
    expect(getMessages("en").ra.action.save).toBe("Save");
    expect(getMessages("pt").ra.action.save).toBe("Salvar");
  });
});
