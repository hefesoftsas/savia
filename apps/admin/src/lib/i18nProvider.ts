import polyglotI18nProvider from "ra-i18n-polyglot";
import { defaultAppLocale, isAppLocale } from "@/i18n/app-locale";
import { getAvailableLocales, getMessages } from "@/i18n/locales";

export const i18nProvider = polyglotI18nProvider(
  (locale) => getMessages(isAppLocale(locale) ? locale : defaultAppLocale),
  defaultAppLocale,
  [...getAvailableLocales()],
  { allowMissing: true },
);
