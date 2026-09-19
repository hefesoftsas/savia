export const appLocales = ["es", "en", "pt"] as const;

export type AppLocale = (typeof appLocales)[number];

export const defaultAppLocale: AppLocale = "es";

export const appLocaleOptions = [
  { locale: "es", name: "Español" },
  { locale: "en", name: "English" },
  { locale: "pt", name: "Português" },
] as const satisfies ReadonlyArray<{ locale: AppLocale; name: string }>;

export function isAppLocale(value: string): value is AppLocale {
  return (appLocales as readonly string[]).includes(value);
}

export function collatorLocale(locale: AppLocale): string {
  if (locale === "pt") return "pt-BR";
  if (locale === "en") return "en";
  return "es";
}

export function htmlLang(locale: AppLocale): string {
  if (locale === "pt") return "pt-BR";
  return locale;
}
