import {
  OfficeAvailabilityProvider,
  useOfficeAvailability,
} from "@/features/office-settings/office-availability";
import { officeSuiteMessages } from "@/features/office-suite/messages";
import { useMessages } from "@/i18n/core";
import { uiMessages } from "@/i18n/locales/ui";
import {
  TenantBrandingProvider,
  useTenantBranding,
} from "@/features/tenant-branding/tenant-branding-provider";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Building2 } from "lucide-react";
import {
  CustomRoutes,
  memoryStore,
  Resource,
  useTranslate,
  useCanAccess,
} from "ra-core";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { createAdminQueryClient } from "./queries/query-policy";
import { usePrincipalGeneration } from "./auth/session-scope";
import { Navigate, Route } from "react-router-dom";
import { getDefaultAppServices, type AppServices } from "@/app-services";
import { preloadRouteModules } from "@/route-preload";
import { tenants } from "@/features/tenants";
import { users } from "@/features/users";
import { PasswordResetPage } from "@/features/users/password-reset-page";
import { AppServicesProvider } from "@/features/assistant/assistant-context";
import { Admin } from "@/components/admin";
import { AppLocaleProvider } from "@/i18n/app-locale-provider";
import { resolveInitialAppLocale } from "@/i18n/locale-storage";
import { OfflineBanner } from "@/offline/offline-banner";
import { PwaSplash } from "@/pwa/pwa-splash";
import { getAdminAuthorizeUrl } from "@/components/admin/loading-recovery";
import { Button } from "@/components/ui/button";
import { RouteLoading } from "@/components/admin/route-loading";
import { TenantHostMismatchError } from "@/components/admin/tenant-mismatch-error";
import { useCurrentTenant } from "@/features/tenants/use-current-tenant";
import { sharedLinkRouteAfterAuth } from "@/pwa/share-target";
import { bookingMessages } from "@/features/bookings/booking-messages";

const RolePages = lazy(async () => ({
  default: (await import("@/features/access-control/role-pages")).RolePages,
}));
// Mismas funciones de importación para la ruta y la precarga: reintentan la
// importación si una precarga fallida la precedió.
export async function loadStudioPage() {
  const module = await import("@/features/studio/studio-page");
  return { default: module.StudioPage };
}
export async function loadPluginStudioPage() {
  const module = await import("@/features/studio/studio-page");
  return { default: module.PluginStudioPage };
}
export async function loadSaviaRequestPage() {
  const module = await import("@/features/savia-request/savia-request-page");
  return { default: module.SaviaRequestPage };
}
const StudioPage = lazy(loadStudioPage);
const PluginStudioPage = lazy(loadPluginStudioPage);
const PersonalIntegrationsPage = lazy(async () => {
  const module =
    await import("@/features/personal-integrations/personal-integrations-page");
  return { default: module.PersonalIntegrationsPage };
});
function OfficeSuiteAccess({ children }: { children: React.ReactNode }) {
  const policy = useOfficeAvailability();
  const t = useMessages(officeSuiteMessages);
  if (policy.loading) return <RouteLoading />;
  if (!policy.enabled)
    return (
      <main className="mx-auto max-w-2xl py-8" role="status">
        <h1 className="text-xl font-semibold">{t("Office suite")}</h1>
        <p className="mt-2 text-muted-foreground">
          {t(
            policy.error
              ? "Could not check office availability. Reload to retry."
              : "Office suite is disabled for this tenant.",
          )}
        </p>
      </main>
    );
  return children;
}
const OfficeSuitePage = lazy(() =>
  import("@/features/office-suite/office-suite-page").then((module) => ({
    default: module.OfficeSuitePage,
  })),
);
const PagesPage = lazy(() =>
  import("@/features/pages/pages-page").then((module) => ({
    default: module.PagesPage,
  })),
);
const SaveLinkPage = lazy(() =>
  import("@/features/pages/save-link-page").then((module) => ({
    default: module.SaveLinkPage,
  })),
);
const BookingPage = lazy(() =>
  import("@/features/bookings/booking-page").then((module) => ({
    default: module.BookingPage,
  })),
);

function BookingRoute({ services }: { services: AppServices }) {
  const tenant = useCurrentTenant();
  const t = useMessages(bookingMessages);
  if (tenant.isLoading) return <RouteLoading />;
  if (tenant.id === null)
    return (
      <main className="p-6" role="alert">
        {t("Appointments are available inside a tenant workspace.")}
      </main>
    );
  return (
    <Suspense fallback={<RouteLoading variant="cards" />}>
      <BookingPage services={services} tenantId={tenant.id} />
    </Suspense>
  );
}

const CompanionRecordingsPage = lazy(async () => ({
  default: (await import("@/features/companion/recordings-page"))
    .CompanionRecordingsPage,
}));
function CompanionRecordingsRoute({ services }: { services: AppServices }) {
  const { canAccess, isPending } = useCanAccess({
    resource: "companion-recordings",
    action: "list",
  });
  if (isPending) return <RouteLoading />;
  if (!canAccess) return <Navigate to="/my-day" replace />;
  return (
    <Suspense fallback={<RouteLoading />}>
      <CompanionRecordingsPage services={services} />
    </Suspense>
  );
}
const MyDayPage = lazy(async () => {
  const module = await import("@/features/personal-integrations/my-day-page");
  return { default: module.MyDayPage };
});
const ServiceCredentialsPage = lazy(async () => {
  const module = await import("@/features/service-credentials");
  return { default: module.ServiceCredentialsPage };
});
const AccountPage = lazy(async () => {
  const module = await import("@/features/account/account-page");
  return { default: module.AccountPage };
});
const NotificationInboxPage = lazy(async () => {
  const module = await import("@/features/notifications/notification-inbox");
  return { default: module.NotificationInbox };
});

const adminStore = memoryStore({ locale: resolveInitialAppLocale() });
const SaviaRequestPage = lazy(loadSaviaRequestPage);

function SaviaRequestRoute({
  services,
  docs = false,
}: {
  services: AppServices;
  docs?: boolean;
}) {
  const translate = useTranslate();
  return (
    <Suspense
      fallback={
        <RouteLoading
          label={translate("savia.routes.loadingSaviaRequest", {
            _: "Cargando Savia Request…",
          })}
        />
      }
    >
      <SaviaRequestPage docs={docs} services={services} />
    </Suspense>
  );
}

function StudioRoute({ services }: { services: AppServices }) {
  return (
    <Suspense fallback={<RouteLoading variant="screens" />}>
      <StudioPage services={services} />
    </Suspense>
  );
}

function PluginStudioRoute({ services }: { services: AppServices }) {
  return (
    <Suspense fallback={<RouteLoading variant="screens" />}>
      <PluginStudioPage services={services} />
    </Suspense>
  );
}

function PersonalIntegrationsRoute({ services }: { services: AppServices }) {
  const translate = useTranslate();
  return (
    <Suspense
      fallback={
        <RouteLoading
          variant="cards"
          label={translate("savia.routes.loadingIntegrations", {
            _: "Cargando integraciones…",
          })}
        />
      }
    >
      <PersonalIntegrationsPage services={services} />
    </Suspense>
  );
}

function MyDayRoute({ services }: { services: AppServices }) {
  const translate = useTranslate();
  return (
    <Suspense
      fallback={
        <RouteLoading
          label={translate("savia.routes.loadingMyDay", {
            _: "Cargando Mi día…",
          })}
        />
      }
    >
      <MyDayPage services={services} />
    </Suspense>
  );
}

function ServiceCredentialsRoute({ services }: { services: AppServices }) {
  const translate = useTranslate();
  return (
    <Suspense
      fallback={
        <RouteLoading
          variant="cards"
          label={translate("savia.routes.loadingCredentials", {
            _: "Cargando claves y servicios…",
          })}
        />
      }
    >
      <ServiceCredentialsPage services={services} />
    </Suspense>
  );
}

function AccountRoute({
  apiUrl,
  services,
}: {
  apiUrl: string;
  services: AppServices;
}) {
  const translate = useTranslate();
  return (
    <Suspense
      fallback={
        <RouteLoading
          label={translate("savia.routes.loadingAccount", {
            _: "Cargando cuenta…",
          })}
        />
      }
    >
      <AccountPage apiUrl={apiUrl} api={services.apiClient} />
    </Suspense>
  );
}

function TenantBrandingRoute({ services }: { services: AppServices }) {
  const t = useMessages(uiMessages);
  return (
    <Suspense
      fallback={<RouteLoading label={t("Cargando identidad del tenant…")} />}
    >
      <TenantBrandingPage services={services} />
    </Suspense>
  );
}

function TenantTitleSync({ title }: { title: string }) {
  const { branding } = useTenantBranding();
  useEffect(() => {
    document.title = branding ? `${branding.displayName} | Savia` : title;
  }, [title, branding]);
  return null;
}

const TenantBrandingPage = lazy(() =>
  import("@/features/tenant-branding/tenant-branding-page").then((module) => ({
    default: module.TenantBrandingPage,
  })),
);

function AuthLoadingFallback() {
  return <PwaSplash recoveryHref={getAdminAuthorizeUrl()} />;
}

export function App({ services }: { services?: AppServices } = {}) {
  const appServices = useMemo(
    () => services ?? getDefaultAppServices(),
    [services],
  );
  const [queryClient] = useState(
    () => appServices.queryClient ?? createAdminQueryClient(),
  );
  const providedServices = useMemo(
    () => ({ ...appServices, queryClient }),
    [appServices, queryClient],
  );
  const generation = usePrincipalGeneration();
  return (
    <QueryClientProvider client={queryClient}>
      <AppServicesProvider services={providedServices}>
        <TenantBrandingProvider>
          <AppContent
            key={generation}
            services={providedServices}
            queryClient={queryClient}
          />
        </TenantBrandingProvider>
      </AppServicesProvider>
    </QueryClientProvider>
  );
}

function AppContent({
  services: appServices,
  queryClient,
}: {
  services: AppServices;
  queryClient: QueryClient;
}) {
  const currentTenant = useCurrentTenant();
  const pageTitle = currentTenant.isDedicated
    ? `${currentTenant.name} | Savia`
    : "Savia";
  const [handlingCallback, setHandlingCallback] = useState(
    () => window.location.pathname === "/auth/callback",
  );
  const finishCallback = useCallback((returnOrigin?: string) => {
    if (returnOrigin) {
      try {
        const target = new URL(returnOrigin);
        if (target.origin !== window.location.origin) {
          // Only a resume marker crosses origins; the draft stays on its host.
          window.location.replace(`${target.origin}/?resume-share=1#/my-day`);
          return;
        }
      } catch {
        // Fall back to same-host routing
      }
    }
    window.history.replaceState(
      {},
      "",
      `/${sharedLinkRouteAfterAuth() ?? "#/my-day"}`,
    );
    setHandlingCallback(false);
  }, []);

  // Precarga tras la pantalla utilizable, sin bloquear la navegación.
  useEffect(() => {
    if (handlingCallback) return;
    preloadRouteModules(appServices, {
      loadStudioPage,
      loadSaviaRequestPage,
    });
  }, [appServices, handlingCallback]);

  if (window.location.pathname === "/auth/reset-password") {
    return (
      <AppLocaleProvider>
        <PasswordResetPage
          apiUrl={import.meta.env.VITE_SAVIA_API_URL ?? window.location.origin}
        />
      </AppLocaleProvider>
    );
  }

  if (handlingCallback) {
    return (
      <AppLocaleProvider>
        <BetterAuthCallback
          services={appServices}
          onComplete={finishCallback}
        />
      </AppLocaleProvider>
    );
  }

  return (
    <OfficeAvailabilityProvider apiClient={appServices.apiClient}>
      <TenantTitleSync title={pageTitle} />
      <OfflineBanner />
      <Admin
        authProvider={appServices.authProvider}
        dataProvider={appServices.dataProvider}
        disableTelemetry
        error={TenantHostMismatchError}
        // Same branded splash as the boot sequence: cold start shows a
        // single continuous visual through the auth check.
        loading={AuthLoadingFallback}
        requireAuth
        queryClient={queryClient}
        store={adminStore}
        title={pageTitle}
      >
        <Resource {...users} />
        <Resource {...tenants} />
        <CustomRoutes>
          <Route
            path="/tenant-branding"
            element={<TenantBrandingRoute services={appServices} />}
          />
          <Route
            path="/bookings"
            element={<BookingRoute services={appServices} />}
          />
          <Route
            path="/roles"
            element={
              <Suspense fallback={<RouteLoading />}>
                <RolePages services={appServices} />
              </Suspense>
            }
          />
          <Route path="/" element={<Navigate to="/my-day" replace />} />
          <Route
            path="/office-suite"
            element={
              <Suspense fallback={<RouteLoading />}>
                <OfficeSuiteAccess>
                  <OfficeSuitePage services={appServices} />
                </OfficeSuiteAccess>
              </Suspense>
            }
          />
          <Route
            path="/pages/:pageId?"
            element={
              <Suspense fallback={<RouteLoading />}>
                <PagesPage services={appServices} />
              </Suspense>
            }
          />
          <Route
            path="/save-link"
            element={
              <Suspense fallback={<RouteLoading />}>
                <SaveLinkPage services={appServices} />
              </Suspense>
            }
          />
          <Route
            path="/studio"
            element={<StudioRoute services={appServices} />}
          />
          <Route
            path="/plugin-studio"
            element={<PluginStudioRoute services={appServices} />}
          />
          {/* Fase 1: alias legacy — #/crm sigue funcionando, canónica es #/studio */}
          <Route path="/crm" element={<StudioRoute services={appServices} />} />
          <Route
            path="/savia-request"
            element={<SaviaRequestRoute services={appServices} />}
          />
          <Route
            path="/savia-request/docs"
            element={<SaviaRequestRoute docs services={appServices} />}
          />
          <Route
            path="/auto-light-quotes/*"
            element={<Navigate replace to="/savia-request" />}
          />
          <Route
            path="/crm-connections"
            element={<Navigate replace to="/my-integrations" />}
          />
          <Route
            path="/my-integrations"
            element={<PersonalIntegrationsRoute services={appServices} />}
          />
          <Route
            path="/my-day"
            element={<MyDayRoute services={appServices} />}
          />
          <Route
            path="/notifications"
            element={
              <Suspense fallback={<RouteLoading />}>
                <NotificationInboxPage />
              </Suspense>
            }
          />
          <Route
            path="/provider-credentials"
            element={<Navigate to="/savia-request" replace />}
          />
          <Route
            path="/account"
            element={
              <AccountRoute
                services={appServices}
                apiUrl={
                  import.meta.env.VITE_SAVIA_API_URL ?? window.location.origin
                }
              />
            }
          />
          <Route
            path="/service-credentials"
            element={<ServiceCredentialsRoute services={appServices} />}
          />
          <Route
            path="/assistant-configuration"
            element={<Navigate to="/service-credentials" replace />}
          />
          <Route
            path="/companion-recordings"
            element={<CompanionRecordingsRoute services={appServices} />}
          />
        </CustomRoutes>
      </Admin>
    </OfficeAvailabilityProvider>
  );
}

function BetterAuthCallback({
  services,
  onComplete,
}: {
  services: AppServices;
  onComplete(returnOrigin?: string): void;
}) {
  const translate = useTranslate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const root = document.documentElement;
    const previousTheme = root.getAttribute("data-color-theme");
    root.setAttribute("data-color-theme", "emerald");

    return () => {
      if (previousTheme === null) {
        root.removeAttribute("data-color-theme");
      } else {
        root.setAttribute("data-color-theme", previousTheme);
      }
    };
  }, []);

  useEffect(() => {
    let active = true;

    void services.authSession.handleCallback().then(
      (result) => {
        if (active) {
          const returnOrigin =
            result &&
            typeof result === "object" &&
            "returnOrigin" in result &&
            typeof result.returnOrigin === "string"
              ? result.returnOrigin
              : undefined;
          onComplete(returnOrigin);
        }
      },
      (exception: unknown) => {
        if (!active) return;
        setError(
          exception instanceof Error
            ? exception.message
            : translate("savia.auth.signInFailedDetails", {
                _: "No fue posible completar el inicio de sesión.",
              }),
        );
      },
    );

    return () => {
      active = false;
    };
  }, [onComplete, services, translate]);

  if (!error) return <PwaSplash recoveryHref={getAdminAuthorizeUrl()} />;

  return (
    <main className="flex min-h-svh items-center justify-center bg-secondary p-6 text-foreground">
      <section className="w-full max-w-md rounded-xl border bg-card p-7 shadow-sm">
        <div className="flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <Building2 className="size-5" />
        </div>
        <h1 className="mt-6 text-2xl font-semibold tracking-tight">
          {translate("savia.auth.signInFailed", {
            _: "No pudimos iniciar sesión",
          })}
        </h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{error}</p>
        <Button
          className="mt-6 w-full"
          onClick={() => window.location.replace(window.location.origin)}
        >
          {translate("savia.auth.returnHome", {
            _: "Volver al inicio",
          })}
        </Button>
      </section>
    </main>
  );
}
