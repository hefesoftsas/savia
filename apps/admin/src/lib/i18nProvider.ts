import polyglotI18nProvider from "ra-i18n-polyglot";
import {
  defaultAppLocale,
  isAppLocale,
  type AppLocale,
} from "@/i18n/app-locale";
import { getAvailableLocales, getMessages } from "@/i18n/locales";

export const createAppI18nProvider = (
  initialLocale: AppLocale = defaultAppLocale,
) =>
  polyglotI18nProvider(
    (locale) => getMessages(isAppLocale(locale) ? locale : defaultAppLocale),
    initialLocale,
    [...getAvailableLocales()],
    { allowMissing: true },
  );

export const i18nProvider = createAppI18nProvider();
