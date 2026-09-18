import { describe, expect, it } from "vitest";
import { getMessages } from "@/i18n/locales";

function saviaMessages(locale: "es" | "en" | "pt") {
  return getMessages(locale).savia as Record<string, unknown>;
}

function getAllKeys(obj: Record<string, unknown>, prefix = ""): string[] {
  const keys: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      keys.push(...getAllKeys(value as Record<string, unknown>, fullKey));
    } else {
      keys.push(fullKey);
    }
  }
  return keys.sort();
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

  it("maintains key parity across Spanish, English, and Portuguese bundles in savia messages", () => {
    const esKeys = getAllKeys(saviaMessages("es"));
    const enKeys = getAllKeys(saviaMessages("en"));
    const ptKeys = getAllKeys(saviaMessages("pt"));

    const missingInEn = esKeys.filter((k) => !enKeys.includes(k));
    const missingInPt = esKeys.filter((k) => !ptKeys.includes(k));
    const extraInEn = enKeys.filter((k) => !esKeys.includes(k));
    const extraInPt = ptKeys.filter((k) => !esKeys.includes(k));

    expect(missingInEn, "Keys in ES but missing in EN").toEqual([]);
    expect(missingInPt, "Keys in ES but missing in PT").toEqual([]);
    expect(extraInEn, "Keys in EN but missing in ES").toEqual([]);
    expect(extraInPt, "Keys in PT but missing in ES").toEqual([]);
  });
});
