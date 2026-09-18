import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Building2, LoaderCircle } from "lucide-react";
import { CustomRoutes, I18nContextProvider, memoryStore, Resource, useTranslate } from "ra-core";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { Navigate, Route } from "react-router-dom";
import { getDefaultAppServices, type AppServices } from "@/app-services";
import { tenants } from "@/features/tenants";
import { users } from "@/features/users";
import { PasswordResetPage } from "@/features/users/password-reset-page";
import { AppServicesProvider } from "@/features/assistant/assistant-context";
import { Admin } from "@/components/admin";
import { i18nProvider } from "@/lib/i18nProvider";
import { OfflineBanner } from "@/offline/offline-banner";
import { OutboxStatus } from "@/offline/outbox-status";
import { createOfflinePersister } from "@/offline/query-persister";
import { shouldPersistQueryKey } from "@/offline/persisted-keys";
import {
  OFFLINE_CACHE_MAX_AGE_MS,
  createOfflineQueryClient,
} from "@/offline/query-client";
import { Button } from "@/components/ui/button";
import { RouteLoading } from "@/components/admin/route-loading";
import { TenantHostMismatchError } from "@/components/admin/tenant-mismatch-error";
import { useCurrentTenant } from "@/features/tenants/use-current-tenant";

const CrmPage = lazy(async () => {
  const module = await import("@/features/dynamic-crm/crm-page");
  return { default: module.CrmPage };
});
const PersonalIntegrationsPage = lazy(async () => {
  const module =
    await import("@/features/personal-integrations/personal-integrations-page");
  return { default: module.PersonalIntegrationsPage };
});
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
const OfflinePoliciesPage = lazy(async () => {
  const module = await import("@/features/offline-policies");
  return { default: module.OfflinePoliciesPage };
});

const adminStore = memoryStore();
const SaviaRequestPage = lazy(async () => {
  const module = await import("@/features/savia-request/savia-request-page");
  return { default: module.SaviaRequestPage };
});

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

function CrmRoute({ services }: { services: AppServices }) {
  return (
    <Suspense fallback={<RouteLoading variant="screens" />}>
      <CrmPage services={services} />
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

function OfflinePoliciesRoute({ services }: { services: AppServices }) {
  const translate = useTranslate();
  return (
    <Suspense
      fallback={
        <RouteLoading
          label={translate("savia.routes.loadingOffline", {
            _: "Cargando modo sin conexión…",
          })}
        />
      }
    >
      <OfflinePoliciesPage services={services} />
    </Suspense>
  );
}

function AccountRoute({ apiUrl }: { apiUrl: string }) {  const translate = useTranslate();
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
      <AccountPage apiUrl={apiUrl} />
    </Suspense>
  );
}

function TenantTitleSync({ title }: { title: string }) {
  useEffect(() => {
    document.title = title;
  }, [title]);
  return null;
}

export function App({ services }: { services?: AppServices } = {}) {
  const currentTenant = useCurrentTenant();
  const pageTitle = currentTenant.isDedicated
    ? `${currentTenant.name} | Savia`
    : "Savia";
  const appServices = useMemo(
    () => services ?? getDefaultAppServices(),
    [services],
  );
  // Offline-first cache owned by app-services (so logout can wipe it);
  // injected services in tests may omit it, hence the fallback.
  const [queryClient] = useState(
    () => appServices.queryClient ?? createOfflineQueryClient(),
  );
  const [persister] = useState(
    () => appServices.persister ?? createOfflinePersister(),
  );
  const [handlingCallback, setHandlingCallback] = useState(
    () => window.location.pathname === "/auth/callback",
  );
  const finishCallback = useCallback((returnOrigin?: string) => {
    if (returnOrigin) {
      try {
        const target = new URL(returnOrigin);
        if (target.origin !== window.location.origin) {
          window.location.replace(`${target.origin}/#/my-day`);
          return;
        }
      } catch {
        // Fall back to same-host routing
      }
    }
    window.history.replaceState({}, "", "/#/my-day");
    setHandlingCallback(false);
  }, []);

  if (window.location.pathname === "/auth/reset-password") {
    return (
      <I18nContextProvider value={i18nProvider}>
        <PasswordResetPage
          apiUrl={import.meta.env.VITE_SAVIA_API_URL ?? window.location.origin}
        />
      </I18nContextProvider>
    );
  }

  if (handlingCallback) {
    return (
      <I18nContextProvider value={i18nProvider}>
        <BetterAuthCallback services={appServices} onComplete={finishCallback} />
      </I18nContextProvider>
    );
  }

  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister,
        maxAge: OFFLINE_CACHE_MAX_AGE_MS,
        dehydrateOptions: {
          shouldDehydrateQuery: (query) =>
            shouldPersistQueryKey(query.queryKey),
        },
      }}
    >
    <AppServicesProvider services={appServices}>
      <TenantTitleSync title={pageTitle} />
      <OfflineBanner />
      <OutboxStatus />
      <Admin
        authProvider={appServices.authProvider}
        dataProvider={appServices.dataProvider}
        disableTelemetry
        error={TenantHostMismatchError}
        requireAuth
        queryClient={queryClient}
        store={adminStore}
        title={pageTitle}
      >
        <Resource {...users} />
        <Resource {...tenants} />
        <CustomRoutes>
          <Route path="/" element={<Navigate to="/my-day" replace />} />
          <Route path="/crm" element={<CrmRoute services={appServices} />} />
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
            path="/provider-credentials"
            element={<Navigate to="/savia-request" replace />}
          />
          <Route
            path="/account"
            element={
              <AccountRoute
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
            path="/offline-policies"
            element={<OfflinePoliciesRoute services={appServices} />}
          />
          <Route
            path="/assistant-configuration"
            element={<Navigate to="/service-credentials" replace />}
          />
        </CustomRoutes>
      </Admin>
    </AppServicesProvider>
    </PersistQueryClientProvider>
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

  return (
    <main className="flex min-h-svh items-center justify-center bg-secondary p-6 text-foreground">
      <section className="w-full max-w-md rounded-xl border bg-card p-7 shadow-sm">
        <div className="flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          {error ? (
            <Building2 className="size-5" />
          ) : (
            <LoaderCircle className="size-5 animate-spin" />
          )}
        </div>
        <h1 className="mt-6 text-2xl font-semibold tracking-tight">
          {error
            ? translate("savia.auth.signInFailed", {
                _: "No pudimos iniciar sesión",
              })
            : translate("savia.auth.connecting", {
                _: "Conectando con Savia",
              })}
        </h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {error ??
            translate("savia.auth.validatingSession", {
              _: "Estamos validando tu sesión segura con Better Auth.",
            })}
        </p>
        {error ? (
          <Button
            className="mt-6 w-full"
            onClick={() => window.location.replace(window.location.origin)}
          >
            {translate("savia.auth.returnHome", {
              _: "Volver al inicio",
            })}
          </Button>
        ) : null}
      </section>
    </main>
  );
}
