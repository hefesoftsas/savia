import { afterEach, describe, expect, it, vi } from "vitest";
import {
  detectLocale,
  formatDuration,
  isLocale,
  loadLocale,
  messageKeys,
  translate,
  type MessageKey,
} from "./i18n";

afterEach(() => vi.unstubAllGlobals());

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

  it("uses the current OS language each launch without browser storage", () => {
    const storage = { getItem: vi.fn(), setItem: vi.fn() };
    vi.stubGlobal("localStorage", storage);
    vi.stubGlobal("navigator", { language: "pt-BR" });

    expect(loadLocale()).toBe("pt");
    expect(loadLocale("en-US")).toBe("en");
    expect(loadLocale("fr-FR")).toBe("es");
    expect(storage.getItem).not.toHaveBeenCalled();
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it("formats track durations using the active locale", () => {
    expect(formatDuration("es", 1.5)).toBe("1,5");
    expect(formatDuration("pt", 1.5)).toBe("1,5");
    expect(formatDuration("en", 1.5)).toBe("1.5");
  });

  it("uses complete localized actions for preview buttons", () => {
    expect(translate("es", "Preview microphone")).toBe(
      "Vista previa del micrófono",
    );
    expect(translate("es", "Preview system audio")).toBe(
      "Vista previa del audio del sistema",
    );
    expect(translate("en", "Preview microphone")).toBe("Preview microphone");
    expect(translate("en", "Preview system audio")).toBe(
      "Preview system audio",
    );
    expect(translate("pt", "Preview microphone")).toBe(
      "Pré-visualizar o microfone",
    );
    expect(translate("pt", "Preview system audio")).toBe(
      "Pré-visualizar o áudio do sistema",
    );
  });

  it("includes localized preview, pause, and native error messages", () => {
    const requiredKeys: MessageKey[] = [
      "Loading preview",
      "Preview on this device before uploading",
      "Preview",
      "Preview microphone",
      "Preview system audio",
      "Paused",
      "Resume recording",
      "Pause",
      "Finish",
      "Recording is paused. Resume to keep adding to the same take.",
      "CAPTURE_PERMISSION_DENIED_MICROPHONE",
      "CAPTURE_PERMISSION_DENIED_SYSTEM",
      "CAPTURE_UNAVAILABLE",
      "CAPTURE_FAILED",
      "OPERATION_FAILED",
    ];

    for (const key of requiredKeys) {
      expect(translate("es", key)).not.toBe(key);
      expect(translate("pt", key)).not.toBe(key);
    }
    expect(translate("es", "Preview on this device before uploading")).toBe(
      "Escucha el audio en este dispositivo antes de subirlo",
    );
    expect(translate("es", "CAPTURE_FAILED")).toBe(
      "No se pudo completar la captura de audio.",
    );
  });

  it("keeps manual locale selection valid for the current window", () => {
    expect(isLocale("pt")).toBe(true);
    expect(isLocale("fr")).toBe(false);
  });
});
