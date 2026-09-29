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
  const services = useAppServices();
  const hydrated = useRef(false);
  const applying = useRef(false);
  const lastSaved = useRef("");
  const current = useRef({ theme, colorTheme });
  current.current = { theme, colorTheme };

  useEffect(() => {
    let active = true;
    if (!services?.userPreferences?.getAppearance) {
      hydrated.current = true;
      return;
    }
    void services.userPreferences.getAppearance().then(
      (saved) => {
        if (!active) return;
        lastSaved.current = JSON.stringify({
          theme: saved.theme,
          colorTheme: saved.colorTheme,
        });
        applying.current = true;
        setTheme(saved.theme);
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
  }, [services, setColorTheme, setTheme]);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      const snapshot = JSON.stringify(current.current);
      try {
        const saved = await services?.userPreferences?.getAppearance?.();
        if (!active || !saved || JSON.stringify(current.current) !== snapshot)
          return;
        lastSaved.current = JSON.stringify({
          theme: saved.theme,
          colorTheme: saved.colorTheme,
        });
        setTheme(saved.theme);
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
  }, [services, setTheme, setColorTheme]);

  useEffect(() => {
    if (!hydrated.current || applying.current) return;
    setCachedAppearance({ theme, colorTheme });
    if (!services?.userPreferences?.saveAppearance) return;
    const fingerprint = JSON.stringify({ theme, colorTheme });
    if (fingerprint === lastSaved.current) return;
    const timer = window.setTimeout(() => {
      const settings = { version: 1 as const, theme, colorTheme };
      void services.userPreferences
        .saveAppearance(settings)
        .then(() => {
          lastSaved.current = fingerprint;
        })
        .catch(() => undefined);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [colorTheme, services, theme]);

  return null;
}
