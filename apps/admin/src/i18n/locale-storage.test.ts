import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  APP_LOCALE_STORAGE_KEY,
  getStoredAppLocale,
  resolveInitialAppLocale,
  setStoredAppLocale,
} from "./locale-storage";

describe("locale storage", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it("returns undefined when storage is empty", () => {
    expect(getStoredAppLocale()).toBeUndefined();
    expect(resolveInitialAppLocale()).toBe("es");
  });

  it("reads and writes supported locales", () => {
    setStoredAppLocale("en");
    expect(getStoredAppLocale()).toBe("en");
    expect(window.localStorage.getItem(APP_LOCALE_STORAGE_KEY)).toBe("en");

    setStoredAppLocale("pt");
    expect(getStoredAppLocale()).toBe("pt");
    expect(resolveInitialAppLocale()).toBe("pt");
  });

  it("ignores unsupported or malformed values and falls back to Spanish", () => {
    window.localStorage.setItem(APP_LOCALE_STORAGE_KEY, "fr");
    expect(getStoredAppLocale()).toBeUndefined();
    expect(resolveInitialAppLocale()).toBe("es");

    window.localStorage.setItem(APP_LOCALE_STORAGE_KEY, "  EN  ");
    expect(getStoredAppLocale()).toBe("en");
  });
});
