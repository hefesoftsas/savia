import { describe, expect, it } from "vitest";
import {
  detectLocale,
  isLocale,
  loadLocale,
  LOCALE_STORAGE_KEY,
  messageKeys,
  saveLocale,
  translate,
} from "./i18n";

const tokens = (text: string) =>
  [...new Set(text.match(/\{[^}]+\}/g) ?? [])].sort();

const vars = {
  uploaded: 1,
  total: 2,
  duration: "1.5",
  size: 3,
  seconds: 4,
  id: "abc12345",
};

describe("Companion desktop locale catalog", () => {
  it("ships Spanish, English, and Portuguese for every message", () => {
    expect(messageKeys.length).toBeGreaterThan(30);
    for (const key of messageKeys) {
      const rendered = {
        es: translate("es", key, vars),
        en: translate("en", key, vars),
        pt: translate("pt", key, vars),
      };
      for (const text of Object.values(rendered)) {
        expect(text.trim(), key).not.toBe("");
        expect(text, key).not.toContain("{");
      }
      expect(tokens(rendered.en), key).toEqual(tokens(rendered.es));
      expect(tokens(rendered.pt), key).toEqual(tokens(rendered.es));
    }
  });

  it("translates selected keys", () => {
    expect(translate("es", "Connect")).toBe("Conectar");
    expect(translate("en", "Connect")).toBe("Connect");
    expect(translate("pt", "Connect")).toBe("Conectar");
    expect(translate("es", "Start recording")).toBe("Iniciar grabación");
  });
});

describe("Companion desktop locale resolution", () => {
  it("detects the OS language with Spanish fallback", () => {
    expect(detectLocale("es-MX")).toBe("es");
    expect(detectLocale("es")).toBe("es");
    expect(detectLocale("en-US")).toBe("en");
    expect(detectLocale("pt-BR")).toBe("pt");
    expect(detectLocale("fr")).toBe("es");
    expect(detectLocale(undefined)).toBe("es");
    expect(detectLocale("")).toBe("es");
  });

  it("prefers the stored locale and persists first-run detection", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
    };
    expect(loadLocale(storage, "en-US")).toBe("en");
    expect(store.get(LOCALE_STORAGE_KEY)).toBe("en");
    expect(loadLocale(storage, "pt-BR")).toBe("en");
    saveLocale("pt", storage);
    expect(loadLocale(storage, "en-US")).toBe("pt");
    expect(isLocale("pt")).toBe(true);
    expect(isLocale("fr")).toBe(false);
  });
});
