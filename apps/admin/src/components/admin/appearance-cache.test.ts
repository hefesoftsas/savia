import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  APPEARANCE_STORAGE_KEY,
  applyCachedAppearance,
  getCachedAppearance,
  setCachedAppearance,
} from "./appearance-cache";

describe("appearance cache", () => {
  beforeEach(() => {
    window.localStorage.clear();
    delete document.documentElement.dataset.colorTheme;
    document.documentElement.classList.remove("light", "dark");
  });

  afterEach(() => {
    window.localStorage.clear();
    delete document.documentElement.dataset.colorTheme;
    document.documentElement.classList.remove("light", "dark");
  });

  it("returns empty appearance when storage is empty or invalid", () => {
    expect(getCachedAppearance()).toEqual({});

    window.localStorage.setItem(APPEARANCE_STORAGE_KEY, "invalid-json");
    expect(getCachedAppearance()).toEqual({});

    window.localStorage.setItem(
      APPEARANCE_STORAGE_KEY,
      JSON.stringify({ colorTheme: "unsupported-color", theme: "unknown" }),
    );
    expect(getCachedAppearance()).toEqual({});
  });

  it("reads and writes valid appearance preferences to localStorage", () => {
    setCachedAppearance({ colorTheme: "violet", theme: "dark" });
    expect(getCachedAppearance()).toEqual({
      colorTheme: "violet",
      theme: "dark",
    });

    // Partial updates merge
    setCachedAppearance({ colorTheme: "blue" });
    expect(getCachedAppearance()).toEqual({
      colorTheme: "blue",
      theme: "dark",
    });
  });

  it("applies cached appearance to the document root element", () => {
    setCachedAppearance({ colorTheme: "amber", theme: "dark" });
    applyCachedAppearance();

    expect(document.documentElement.dataset.colorTheme).toBe("amber");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });
});
