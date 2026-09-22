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
const PublicForm = lazy(async () => {
  const { PublicFormPage } =
    await import("./features/public-forms/public-form-page");
  return { default: PublicFormPage };
});
/** Public visitors never initialize authenticated services or the admin replica. */
export function ApplicationRoot({
  pathname = window.location.pathname,
}: {
  pathname?: string;
}) {
  const publicPath =
    pathname === "/public/forms" || pathname.startsWith("/public/forms/");
  if (publicPath) return <PublicApplication pathname={pathname} />;
  return (
    <Suspense
      fallback={
        <PwaSplash
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
        {match ? (
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
