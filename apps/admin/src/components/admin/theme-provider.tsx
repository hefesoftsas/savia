import { useEffect } from "react";
import { useStore } from "ra-core";
import type { ColorTheme } from "@/color-theme";

import type { Theme } from "./theme-context";
import { ThemeProviderContext } from "./theme-context";
import { AppearancePreferencesSync } from "./appearance-preferences-sync";
import { getCachedAppearance } from "./appearance-cache";

type ThemeProviderProps = {
  children: React.ReactNode;
  defaultTheme?: Theme;
  storageKey?: string;
};

/**
 * Theme provider that enables light, dark, and system theme modes.
 *
 * @internal
 */
export function ThemeProvider({
  children,
  defaultTheme = "light",
  storageKey = "theme",
  ...props
}: ThemeProviderProps) {
  const cached = getCachedAppearance();
  const [theme, setTheme] = useStore<Theme>(
    storageKey,
    cached.theme ?? defaultTheme,
  );
  const [colorTheme, setColorTheme] = useStore<ColorTheme>(
    "color-theme",
    cached.colorTheme ?? "emerald",
  );

  useEffect(() => {
    const root = window.document.documentElement;

    root.classList.remove("light", "dark");

    if (theme === "system") {
      const systemTheme = window.matchMedia("(prefers-color-scheme: dark)")
        .matches
        ? "dark"
        : "light";

      root.classList.add(systemTheme);
      return;
    }

    root.classList.add(theme);
  }, [theme]);

  useEffect(() => {
    const root = window.document.documentElement;
    root.dataset.colorTheme = colorTheme;
    return () => {
      delete root.dataset.colorTheme;
    };
  }, [colorTheme]);

  const value = {
    theme,
    setTheme,
    colorTheme,
    setColorTheme,
  };

  return (
    <ThemeProviderContext.Provider {...props} value={value}>
      <AppearancePreferencesSync />
      {children}
    </ThemeProviderContext.Provider>
  );
}
