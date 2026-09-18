import { useEffect, useRef } from "react";
import type { ColorTheme } from "@/color-theme";
import { useAppServices } from "@/features/assistant/assistant-context";
import { useTheme } from "@/components/admin/use-theme";
import { useOutbox } from "@/offline/use-outbox";
import { setCachedAppearance } from "./appearance-cache";

/**
 * Loads and persists palette and light/dark mode per authenticated principal.
 */
export function AppearancePreferencesSync() {
  const { theme, setTheme, colorTheme, setColorTheme } = useTheme();
  const services = useAppServices();
  const { saveOrQueue } = useOutbox();
  const hydrated = useRef(false);
  const applying = useRef(false);

  useEffect(() => {
    let active = true;
    if (!services?.userPreferences?.getAppearance) {
      hydrated.current = true;
      return;
    }
    void services.userPreferences.getAppearance().then(
      (saved) => {
        if (!active) return;
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
    if (!hydrated.current || applying.current) return;
    setCachedAppearance({ theme, colorTheme });
    if (!services?.userPreferences?.saveAppearance) return;
    const timer = window.setTimeout(() => {
      const settings = { version: 1 as const, theme, colorTheme };
      void saveOrQueue(
        "user-preferences",
        "save-appearance",
        settings,
        () => services.userPreferences.saveAppearance(settings),
      ).catch(() => undefined);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [colorTheme, saveOrQueue, services, theme]);

  return null;
}
