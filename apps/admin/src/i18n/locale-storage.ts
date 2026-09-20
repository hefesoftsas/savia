import { defaultAppLocale, isAppLocale, type AppLocale } from "./app-locale";

export const APP_LOCALE_STORAGE_KEY = "savia.locale";

export function getStoredAppLocale(): AppLocale | undefined {
  if (typeof window === "undefined" || !window.localStorage) {
    return undefined;
  }
  try {
    const raw = window.localStorage.getItem(APP_LOCALE_STORAGE_KEY);
    if (!raw) return undefined;
    const value = raw.trim().toLowerCase();
    return isAppLocale(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

export function setStoredAppLocale(locale: AppLocale): void {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }
  try {
    window.localStorage.setItem(APP_LOCALE_STORAGE_KEY, locale);
  } catch {
    // Ignore storage quota or access exceptions in restricted environments
  }
}

export function resolveInitialAppLocale(): AppLocale {
  return getStoredAppLocale() ?? defaultAppLocale;
}
