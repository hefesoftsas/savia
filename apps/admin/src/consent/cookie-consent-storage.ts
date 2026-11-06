export const COOKIE_CONSENT_STORAGE_KEY = "savia.consent.cookies";
export const COOKIE_CONSENT_VERSION = 1;

export type OptionalCookieCategory = "analytics" | "marketing";

export interface CookieConsentPreferences {
  version: number;
  decidedAt: string;
  optional: Record<OptionalCookieCategory, boolean>;
}

export function getCookieConsent(): CookieConsentPreferences | null {
  if (typeof window === "undefined" || !window.localStorage) {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(COOKIE_CONSENT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CookieConsentPreferences;
    if (
      !parsed ||
      parsed.version !== COOKIE_CONSENT_VERSION ||
      typeof parsed.decidedAt !== "string" ||
      !parsed.optional ||
      typeof parsed.optional.analytics !== "boolean" ||
      typeof parsed.optional.marketing !== "boolean"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function setCookieConsent(
  optional: Record<OptionalCookieCategory, boolean>,
): CookieConsentPreferences {
  const preferences: CookieConsentPreferences = {
    version: COOKIE_CONSENT_VERSION,
    decidedAt: new Date().toISOString(),
    optional: { ...optional },
  };
  try {
    window.localStorage.setItem(
      COOKIE_CONSENT_STORAGE_KEY,
      JSON.stringify(preferences),
    );
  } catch {
    // storage unavailable: consent held in component state for this session
  }
  return preferences;
}

export function hasCookieConsent(): boolean {
  return getCookieConsent() !== null;
}
