import { useCallback } from "react";
import { useLocaleState } from "ra-core";
import { defaultAppLocale, isAppLocale, type AppLocale } from "./app-locale";

/** Every built-in message must ship all three supported languages: ES, EN, PT. */
export type MessageCatalog = Readonly<
  Record<string, readonly [string, string, string]>
>;
export type MessageParams = Readonly<Record<string, string | number>>;
const localeIndex = { es: 0, en: 1, pt: 2 } as const;

export function intlLocale(locale: AppLocale): string {
  return { es: "es-CO", en: "en-US", pt: "pt-BR" }[locale];
}

export function useAppLocale(): AppLocale {
  const [locale] = useLocaleState();
  return isAppLocale(locale) ? locale : defaultAppLocale;
}

/** Only system message keys belong here; user-authored text is rendered verbatim. */
export function translateMessage<C extends MessageCatalog>(
  catalog: C,
  key: keyof C & string,
  locale: AppLocale,
  params: MessageParams = {},
): string {
  const translations = catalog[key];
  if (!translations) throw new Error(`Missing core message: ${key}`);
  const message = translations[localeIndex[locale]];
  return message.replace(/%\{([^}]+)\}/g, (token, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name)
      ? String(params[name])
      : token,
  );
}

/** Subscribe to the existing locale store; changing language preserves component state. */
export function useMessages<C extends MessageCatalog>(catalog: C) {
  const locale = useAppLocale();
  return useCallback(
    (key: keyof C & string, params?: MessageParams) =>
      translateMessage(catalog, key, locale, params),
    [catalog, locale],
  );
}
