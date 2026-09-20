import { useMemo, type ReactNode } from "react";
import { I18nContext, useStore } from "ra-core";
import { defaultAppLocale, isAppLocale } from "./app-locale";
import { createAppI18nProvider } from "@/lib/i18nProvider";

/** Build a provider for the selected locale before react-admin observes the store.
 * Its built-in provider otherwise changes a React key and discards unsaved forms.
 */
export function useAppI18nProvider() {
  const [selected] = useStore<string>("locale", defaultAppLocale);
  const locale = isAppLocale(selected) ? selected : defaultAppLocale;
  return useMemo(() => createAppI18nProvider(locale), [locale]);
}

export function AppLocaleProvider({ children }: { children: ReactNode }) {
  const provider = useAppI18nProvider();
  return (
    <I18nContext.Provider value={provider}>{children}</I18nContext.Provider>
  );
}
