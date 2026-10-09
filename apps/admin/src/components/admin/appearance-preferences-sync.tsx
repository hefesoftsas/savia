import { useEffect, useRef } from "react";
import type { ColorTheme } from "@/color-theme";
import { useAppServices } from "@/features/assistant/assistant-context";
import { useTheme } from "@/components/admin/use-theme";
import { setCachedAppearance } from "./appearance-cache";

/**
 * Loads and persists palette and light/dark mode per authenticated principal.
 */
export function AppearancePreferencesSync() {
  const { theme, setTheme, colorTheme, setColorTheme } = useTheme();
  const preferences = useAppServices().userPreferences;
  const hydrated = useRef(false);
  const applying = useRef(false);
  const lastSaved = useRef("");
  const current = useRef({ theme, colorTheme });
  current.current = { theme, colorTheme };

  useEffect(() => {
    let active = true;
    if (!preferences?.getAppearance) {
      hydrated.current = true;
      return;
    }
    void preferences.getAppearance().then(
      (saved) => {
        if (!active) return;
        lastSaved.current = JSON.stringify({
          theme: saved.theme,
          colorTheme: saved.colorTheme,
        });
        applying.current = true;
        if (saved.theme !== current.current.theme) setTheme(saved.theme);
        if (saved.colorTheme !== current.current.colorTheme)
          setColorTheme(saved.colorTheme as ColorTheme);
        setCachedAppearance({
          theme: saved.theme,
          colorTheme: saved.colorTheme as ColorTheme,
        });
        applying.current = false;
        hydrated.current = true;
      },
      () => {
        if (active) hydrated.current = true;
      },
    );
    return () => {
      active = false;
    };
  }, [preferences, setColorTheme, setTheme]);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      const snapshot = JSON.stringify(current.current);
      try {
        const saved = await preferences?.getAppearance?.();
        if (!active || !saved || JSON.stringify(current.current) !== snapshot)
          return;
        lastSaved.current = JSON.stringify({
          theme: saved.theme,
          colorTheme: saved.colorTheme,
        });
        if (saved.theme !== current.current.theme) setTheme(saved.theme);
        if (saved.colorTheme !== current.current.colorTheme)
          setColorTheme(saved.colorTheme as ColorTheme);
      } catch {
        /* Retain the current appearance until reconnection. */
      }
    };
    window.addEventListener("savia:account-changed", refresh);
    return () => {
      active = false;
      window.removeEventListener("savia:account-changed", refresh);
    };
  }, [preferences, setTheme, setColorTheme]);

  useEffect(() => {
    if (!hydrated.current || applying.current) return;
    setCachedAppearance({ theme, colorTheme });
    if (!preferences?.saveAppearance) return;
    const fingerprint = JSON.stringify({ theme, colorTheme });
    if (fingerprint === lastSaved.current) return;
    const timer = window.setTimeout(() => {
      const settings = { version: 1 as const, theme, colorTheme };
      void preferences
        .saveAppearance(settings)
        .then(() => {
          lastSaved.current = fingerprint;
        })
        .catch(() => undefined);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [colorTheme, preferences, theme]);

  return null;
}
