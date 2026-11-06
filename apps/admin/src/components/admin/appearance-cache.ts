import { isColorTheme, type ColorTheme } from "@/color-theme";
import type { Theme } from "./theme-context";

export const APPEARANCE_STORAGE_KEY = "savia.appearance";

export type CachedAppearance = {
  theme?: Theme;
  colorTheme?: ColorTheme;
};

export function getCachedAppearance(): CachedAppearance {
  if (typeof window === "undefined" || !window.localStorage) {
    return {};
  }
  try {
    const raw = window.localStorage.getItem(APPEARANCE_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const result: CachedAppearance = {};
    if (
      parsed.theme === "light" ||
      parsed.theme === "dark" ||
      parsed.theme === "system"
    ) {
      result.theme = parsed.theme;
    }
    if (isColorTheme(parsed.colorTheme)) {
      result.colorTheme = parsed.colorTheme;
    }
    return result;
  } catch {
    return {};
  }
}

export function setCachedAppearance(
  appearance: Partial<CachedAppearance>,
): void {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }
  try {
    const current = getCachedAppearance();
    window.localStorage.setItem(
      APPEARANCE_STORAGE_KEY,
      JSON.stringify({ ...current, ...appearance }),
    );
  } catch {
    // Ignore storage quota or access exceptions in restricted environments
  }
}

export function applyCachedAppearance(): void {
  if (typeof document === "undefined") return;
  const { theme, colorTheme } = getCachedAppearance();
  const root = document.documentElement;
  if (colorTheme) {
    root.dataset.colorTheme = colorTheme;
  }
  if (theme) {
    root.classList.remove("light", "dark");
    if (theme === "system") {
      const isDark =
        typeof window !== "undefined" &&
        window.matchMedia("(prefers-color-scheme: dark)").matches;
      root.classList.add(isDark ? "dark" : "light");
    } else {
      root.classList.add(theme);
    }
  }
}
