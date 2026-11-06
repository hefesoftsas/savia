import { useEffect } from "react";
import { useLocaleState } from "ra-core";
import { isAppLocale } from "./app-locale";
import { setStoredAppLocale } from "./locale-storage";

/**
 * Persists the selected UI language to localStorage so it survives reloads
 * and new sessions on the same device. Runs alongside LocaleHtmlSync inside
 * a react-admin store context.
 */
export function LocalePersistenceSync() {
  const [locale] = useLocaleState();

  useEffect(() => {
    if (isAppLocale(locale)) {
      setStoredAppLocale(locale);
    }
  }, [locale]);

  return null;
}
