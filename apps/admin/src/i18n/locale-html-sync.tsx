import { useEffect } from "react";
import { useLocaleState } from "ra-core";
import { htmlLang, isAppLocale } from "@/i18n/app-locale";

export function LocaleHtmlSync() {
  const [locale] = useLocaleState();
  const resolved = isAppLocale(locale) ? locale : "es";

  useEffect(() => {
    document.documentElement.lang = htmlLang(resolved);
  }, [resolved]);

  return null;
}
