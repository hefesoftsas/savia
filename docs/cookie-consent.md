# Cookie consent

Mandatory consent banner for the admin/workspace SPA and public forms. The
banner is shown once per user and is never dismissible without a decision: it
stays visible until the user accepts all cookies, allows only essential
cookies, or saves custom preferences.

## Behavior

- Mount points: `apps/admin/src/components/admin/layout.tsx` (authenticated
  app, next to the PWA install banner) and `PublicApplication` in
  `apps/admin/src/bootstrap.tsx` (public forms under `/public/forms/...`).
- The decision is stored in `localStorage` under `savia.consent.cookies`
  (per browser/device), versioned through `COOKIE_CONSENT_VERSION`. A stored
  decision with a stale or malformed version re-shows the banner, so consent
  can be re-required when cookie categories change.
- Categories: essential (session/auth cookies, always on, not toggleable),
  analytics and marketing (off unless explicitly accepted).
- Copy is translated through the existing i18n layer (ES/EN/PT) using
  `savia.consent.*` keys with Spanish fallbacks.

## Code

- `apps/admin/src/consent/cookie-consent-storage.ts` — read/write helpers.
- `apps/admin/src/consent/cookie-consent-banner.tsx` — banner + preferences
  dialog (unit tests in `cookie-consent-banner.test.tsx`).

Integrations that drop non-essential cookies or trackers must gate them on
`getCookieConsent()?.optional.<category>`.

Owner: platform team · Review date: 2027-09
