import englishMessages from "ra-language-english";
import portugueseMessages from "ra-language-pt-br";
import type { TranslationMessages } from "ra-core";
import type { AppLocale } from "@/i18n/app-locale";
import { mergeMessages } from "@/i18n/merge-messages";
import { spanishRaMessages } from "@/i18n/locales/ra-es";
import { saviaMessagesByLocale } from "@/i18n/locales/savia";

const localeMessages: Record<AppLocale, TranslationMessages> = {
  en: mergeMessages(englishMessages, saviaMessagesByLocale.en),
  es: mergeMessages(englishMessages, spanishRaMessages, saviaMessagesByLocale.es),
  pt: mergeMessages(englishMessages, portugueseMessages, saviaMessagesByLocale.pt),
};

export function getMessages(locale: AppLocale): TranslationMessages {
  return localeMessages[locale] ?? localeMessages.es;
}

export function getAvailableLocales() {
  return [
    { locale: "es", name: "Español" },
    { locale: "en", name: "English" },
    { locale: "pt", name: "Português" },
  ] as const;
}
