import {
  pluginIntlLocale,
  type PluginLocale,
} from "@savia/studio-shared/plugin-localization";
import { cents, day, today as genericToday } from "@savia/plugin-ui/data";
export {
  text,
  day,
  cents,
  errorMessage,
  csv,
  loadRecords,
} from "@savia/plugin-ui/data";
export type { WorkRecord } from "@savia/plugin-ui/data";

/** Keep the historical insurance date boundary for existing plugin callers. */
export const today = () => genericToday("America/Bogota");

/** Insurance compatibility formatter; generic package consumers choose a currency explicitly. */
export function money(value: unknown, locale: PluginLocale = "es"): string {
  const amount = cents(value);
  return amount === null
    ? { es: "Sin valor", en: "No amount", pt: "Sem valor" }[locale]
    : new Intl.NumberFormat(pluginIntlLocale(locale), {
        style: "currency",
        currency: "COP",
        maximumFractionDigits: 2,
      }).format(amount / 100);
}

export function dateLabel(value: unknown, locale: PluginLocale = "es"): string {
  const stamp = day(value);
  return stamp === null
    ? { es: "Sin fecha", en: "No date", pt: "Sem data" }[locale]
    : new Intl.DateTimeFormat(pluginIntlLocale(locale), {
        timeZone: "UTC",
        day: "numeric",
        month: "short",
        year: "numeric",
      }).format(new Date(stamp * 86400000));
}
