import { StoreContextProvider, memoryStore, useSetLocale } from "ra-core";
import { AppLocaleProvider } from "./i18n/app-locale-provider";
import { LocaleHtmlSync } from "./i18n/locale-html-sync";
import { LocalePersistenceSync } from "./i18n/locale-persistence-sync";
import { resolveInitialAppLocale } from "./i18n/locale-storage";
import {
  appLocaleOptions,
  defaultAppLocale,
  isAppLocale,
} from "./i18n/app-locale";
import { useMessages, useAppLocale, translateMessage } from "./i18n/core";
import { publicFormsMessages } from "./i18n/locales/public-forms";
import { lazy, Suspense, useMemo } from "react";
import { registerPwaServiceWorker } from "./pwa/register-service-worker";
import { PwaSplash } from "./pwa/pwa-splash";
import { getAdminAuthorizeUrl } from "./components/admin/loading-recovery";
import { CookieConsentBanner } from "./consent/cookie-consent-banner";

const PrivateApp = lazy(async () => {
  registerPwaServiceWorker();
  const [{ App }, { applyCachedAppearance }] = await Promise.all([
    import("./app"),
    import("./components/admin/appearance-cache"),
  ]);
  applyCachedAppearance();
  return { default: App };
});
const PublicQuote = lazy(async () => {
  const { PublicQuotePage } =
    await import("./features/public-quotes/public-quote-page");
  return { default: PublicQuotePage };
});
const PublicForm = lazy(async () => {
  const { PublicFormPage } =
    await import("./features/public-forms/public-form-page");
  return { default: PublicFormPage };
});
const PublicPageRoute = lazy(async () => {
  const { PublicPage } = await import("./features/pages/public-page");
  return { default: PublicPage };
});
const PublicRegistration = lazy(async () => {
  const { RegistrationPage } =
    await import("./features/tenant-registration/registration-page");
  return { default: RegistrationPage };
});
const PublicBooking = lazy(async () => {
  const { PublicBookingPage } =
    await import("./features/bookings/public-booking-page");
  return { default: PublicBookingPage };
});
const PublicBookingManage = lazy(async () => {
  const { PublicBookingManagePage } =
    await import("./features/bookings/public-booking-manage-page");
  return { default: PublicBookingManagePage };
});
/** Public visitors never initialize authenticated services or the admin replica. */
export function ApplicationRoot({
  pathname = window.location.pathname,
}: {
  pathname?: string;
}) {
  const publicPath =
    pathname === "/register" ||
    pathname === "/public/forms" ||
    pathname.startsWith("/public/forms/") ||
    pathname === "/public/pages" ||
    pathname.startsWith("/public/pages/") ||
    pathname === "/public/quotes" ||
    pathname.startsWith("/public/quotes/") ||
    pathname === "/public/bookings" ||
    pathname.startsWith("/public/bookings/");
  if (publicPath) return <PublicApplication pathname={pathname} />;
  return (
    <Suspense
      fallback={
        <PwaSplash
          recoveryHref={getAdminAuthorizeUrl()}
          message={translateMessage(
            publicFormsMessages,
            "Cargando…",
            defaultAppLocale,
          )}
        />
      }
    >
      <PrivateApp />
    </Suspense>
  );
}

function PublicApplication({ pathname }: { pathname: string }) {
  const store = useMemo(
    () => memoryStore({ locale: resolveInitialAppLocale() }),
    [],
  );
  return (
    <StoreContextProvider value={store}>
      <AppLocaleProvider>
        <LocaleHtmlSync />
        <LocalePersistenceSync />
        <CookieConsentBanner />
        <PublicApplicationContent pathname={pathname} />
      </AppLocaleProvider>
    </StoreContextProvider>
  );
}

function PublicApplicationContent({ pathname }: { pathname: string }) {
  const t = useMessages(publicFormsMessages);
  const locale = useAppLocale();
  const setLocale = useSetLocale();
  const match = /^\/public\/forms\/([A-Za-z0-9_-]{20,128})\/?$/.exec(pathname);
  const publicPageMatch =
    /^\/public\/pages\/([A-Za-z0-9_-]{20,128})(?:\/([A-Za-z0-9_-]+))?\/?$/.exec(
      pathname,
    );
  const publicQuoteMatch = /^\/public\/quotes\/([a-fA-F0-9]{64})\/?$/.exec(
    pathname,
  );
  const publicBookingManageMatch =
    /^\/public\/bookings\/manage\/([A-Za-z0-9_-]{20,128})\/?$/.exec(pathname);
  const publicBookingMatch =
    /^\/public\/bookings\/([A-Za-z0-9_-]{20,128})\/?$/.exec(pathname);
  return (
    <>
      <div className="flex justify-end gap-2 px-6 py-3">
        <label className="flex items-center gap-2 text-sm">
          {t("Idioma")}
          <select
            className="rounded-md border bg-background px-2 py-1"
            value={locale}
            onChange={(event) => {
              if (isAppLocale(event.target.value))
                void setLocale(event.target.value);
            }}
          >
            {appLocaleOptions.map((option) => (
              <option key={option.locale} value={option.locale}>
                {option.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <Suspense fallback={<PwaSplash message={t("Cargando…")} />}>
        {pathname === "/register" ? (
          <PublicRegistration />
        ) : publicQuoteMatch ? (
          <PublicQuote token={publicQuoteMatch[1]} />
        ) : publicBookingManageMatch ? (
          <PublicBookingManage token={publicBookingManageMatch[1]} />
        ) : publicBookingMatch ? (
          <PublicBooking token={publicBookingMatch[1]} />
        ) : publicPageMatch ? (
          <PublicPageRoute
            token={publicPageMatch[1]}
            pageId={publicPageMatch[2]}
          />
        ) : match ? (
          <PublicForm token={match[1]} />
        ) : (
          <main className="p-6" role="alert">
            {t("El enlace público no es válido.")}
          </main>
        )}
      </Suspense>
    </>
  );
}
