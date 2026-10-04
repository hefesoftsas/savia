import { OfficeAvailabilityProvider } from "@/features/office-settings/office-availability";
import { useMessages } from "@/i18n/core";
import { automationMessages } from "@/i18n/locales/automation";
import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useCanAccess } from "ra-core";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { AppServices } from "@/app-services";
import { createEmbeddedTransport } from "@/api/embedded-transport";
import { Label } from "@/components/ui/label";
import { RouteLoading } from "@/components/admin/route-loading";
import { useIsMobile } from "@/hooks/use-mobile";
import { studioTenantSearch, studioItems } from "./studio-navigation";
import {
  STUDIO_TENANTS_CHANGED,
  listStudioTenants,
  selectStudioTenant,
  type StudioTenant,
} from "./studio-tenants";
import { setStudioRuntime } from "@/features/studio-engine/runtime";
import {
  getStudioQueryClient,
  pruneStudioQueryCache,
  setStudioQueryOwner,
  studioCacheOwner,
} from "@/features/studio-engine/studio-query-cache";
import type { QueryClient } from "@tanstack/react-query";
import { LocalSyncStatus } from "@/local-data/sync-status";
import type { LocalWorkspace } from "@/local-data/workspaces";
import "./embedded.css";

const StudioRoot = lazy(() => import("@/features/studio-engine/app"));
const PluginProjectWorkspace = lazy(
  () => import("@/features/studio-engine/plugin-project-workspace"),
);

export function StudioPage({
  services,
  pluginStudio = false,
}: {
  services: AppServices;
  pluginStudio?: boolean;
}) {
  const t = useMessages(automationMessages);
  const isMobile = useIsMobile();
  const { canAccess, isPending } = useCanAccess({
    resource: "studio",
    action: "list",
  });
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [tenants, setTenants] = useState<StudioTenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const knownTenantKeys = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (!canAccess) return;
    let active = true;
    try {
      void services.authSession
        .getIdentity?.()
        .then((identity) => {
          if (!active) return;
          const id = (identity as { id?: unknown } | undefined)?.id;
          setStudioQueryOwner(
            studioCacheOwner(window.location.origin, String(id ?? "anon")),
          );
        })
        .catch(() => undefined);
    } catch {
      /* Tests may not provide an auth session. */
    }
    let request = 0;
    const refresh = () => {
      const current = ++request;
      void listStudioTenants(services)
        .then((result) => {
          if (!active || current !== request) return;
          setTenants(result);
          setError("");
          const keys = new Set(result.map((tenant) => tenant.id));
          if (knownTenantKeys.current) pruneStudioQueryCache(keys);
          knownTenantKeys.current = keys;
        })
        .catch((cause) => {
          if (active && current === request)
            setError(
              cause instanceof Error
                ? cause.message
                : t("No se pudieron cargar los tenants."),
            );
        })
        .finally(() => active && current === request && setLoading(false));
    };
    refresh();
    window.addEventListener(STUDIO_TENANTS_CHANGED, refresh);
    return () => {
      active = false;
      window.removeEventListener(STUDIO_TENANTS_CHANGED, refresh);
    };
  }, [canAccess, services]);

  const rawTenantId = params.get("tenantId");
  const requestedTenantId =
    rawTenantId !== null && /^\d+$/.test(rawTenantId)
      ? Number(rawTenantId)
      : undefined;
  const selected =
    selectStudioTenant(tenants, requestedTenantId) ??
    (requestedTenantId === undefined && tenants.length === 1
      ? tenants[0]
      : undefined);
  useEffect(() => {
    if (!selected || params.get("tenantId") === String(selected.tenantId))
      return;
    const next = new URLSearchParams(params);
    next.set("tenantId", String(selected.tenantId));
    next.delete("domain");
    next.delete("agencyId");
    setParams(next, { replace: true });
  }, [selected?.tenantId, params, setParams]);

  const requestedTool = studioItems.find(
    (item) => item.view === params.get("view"),
  );
  if (isPending) return <RouteLoading variant="screens" />;
  if (!canAccess)
    return (
      <p role="alert">
        {t(
          "Studio está disponible para administradores de organización y plataforma.",
        )}
      </p>
    );
  const headerActions =
    typeof document === "undefined"
      ? null
      : document.getElementById("header-actions");
  const tenantContext =
    selected && tenants.length > 1 ? (
      <label className="flex min-w-0 max-w-full items-center gap-2">
        <span className="sr-only">{t("Tenant")}</span>
        <select
          aria-label={t("Tenant")}
          className="h-8 min-w-0 max-w-full rounded-md border bg-background px-2 text-sm max-sm:h-11 sm:max-w-64"
          value={String(selected.tenantId)}
          onChange={(event) =>
            setParams(studioTenantSearch(params, Number(event.target.value)))
          }
        >
          {tenants.map((tenant) => (
            <option key={tenant.id} value={tenant.tenantId}>
              {tenant.label}
            </option>
          ))}
        </select>
      </label>
    ) : null;

  return (
    <section
      className={
        pluginStudio
          ? "@container flex min-h-0 min-w-0 w-full flex-1 flex-col"
          : "@container min-w-0 w-full"
      }
    >
      {selected && headerActions && params.get("view") !== "audit" ? (
        isMobile ? (
          <div className="mb-3 flex min-w-0 justify-end">{tenantContext}</div>
        ) : (
          createPortal(tenantContext, headerActions)
        )
      ) : null}
      {!selected && (
        <header className="mb-2 grid max-w-md gap-1.5">
          <h1 className="sr-only">{t("Studio")}</h1>
          {tenants.length > 1 && (
            <>
              <Label htmlFor="studio-tenant">{t("Tenant")}</Label>
              <select
                id="studio-tenant"
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                value=""
                disabled={loading || !tenants.length}
                onChange={(event) =>
                  setParams(
                    studioTenantSearch(params, Number(event.target.value)),
                  )
                }
              >
                <option value="">{t("Selecciona un tenant")}</option>
                {tenants.map((tenant) => (
                  <option value={tenant.tenantId} key={tenant.id}>
                    {tenant.label}
                  </option>
                ))}
              </select>
            </>
          )}
          {tenants.length === 1 && (
            <button
              type="button"
              className="text-left text-sm text-primary underline"
              onClick={() =>
                setParams(studioTenantSearch(params, tenants[0].tenantId))
              }
            >
              {tenants[0].label}
            </button>
          )}
          {!loading && !tenants.length && (
            <p className="text-sm text-muted-foreground">
              {t(
                "No tienes tenants disponibles. Solicita acceso a un administrador.",
              )}
            </p>
          )}
        </header>
      )}
      {error && !selected ? (
        <p role="alert">{error}</p>
      ) : loading ? (
        <RouteLoading variant="screens" />
      ) : selected ? (
        <StudioWorkspace
          key={selected.id}
          services={services}
          tenant={selected}
          pluginStudio={pluginStudio}
          pluginSource={
            pluginStudio && params.get("source") && params.get("version")
              ? { id: params.get("source")!, version: params.get("version")! }
              : undefined
          }
          onExitPluginStudio={() =>
            navigate(
              `/studio?tenantId=${selected.tenantId}&view=admin&tab=extensions`,
            )
          }
          onPluginSourceOpened={() => {
            const next = new URLSearchParams(params);
            next.delete("source");
            next.delete("version");
            setParams(next, { replace: true });
          }}
          query={(() => {
            const next = new URLSearchParams(params);
            next.set("tenantId", String(selected.tenantId));
            next.delete("domain");
            next.delete("agencyId");
            return next.toString();
          })()}
          onNavigate={(query, replace) => {
            const next = new URLSearchParams(query);
            next.set("tenantId", String(selected.tenantId));
            next.delete("domain");
            next.delete("agencyId");
            setParams(next, { replace });
          }}
        />
      ) : (
        <div className="py-8 text-muted-foreground">
          <h2 className="mb-2 text-lg font-semibold text-foreground">
            {requestedTool?.label ?? t("Pantallas")}
          </h2>
          <p>
            {t(
              "Selecciona un tenant para administrar sus pantallas y plugins.",
            )}
          </p>
        </div>
      )}
    </section>
  );
}

/** Reuses Studio's tenant authorization and runtime, with a standalone editor surface. */
export function PluginStudioPage({ services }: { services: AppServices }) {
  return <StudioPage services={services} pluginStudio />;
}

function StudioWorkspace({
  services,
  tenant,
  query,
  pluginStudio = false,
  pluginSource,
  onExitPluginStudio,
  onPluginSourceOpened,
  onNavigate,
}: {
  services: AppServices;
  tenant: StudioTenant;
  query: string;
  pluginStudio?: boolean;
  pluginSource?: { id: string; version: string };
  onExitPluginStudio?: () => void;
  onPluginSourceOpened?: () => void;
  onNavigate: (query: string, replace?: boolean) => void;
}) {
  const t = useMessages(automationMessages);

  const navigate = useRef(onNavigate);
  navigate.current = onNavigate;
  const transport = useMemo(
    () => createEmbeddedTransport(services.apiClient, tenant.apiBasePath),
    [tenant.apiBasePath, services.apiClient],
  );
  const [readyTransport, setReadyTransport] = useState<typeof transport | null>(
    null,
  );
  const [workspace, setWorkspace] = useState<LocalWorkspace>();
  const [startupError, setStartupError] = useState<string>();
  const [studioClient, setStudioClient] = useState<QueryClient | null>(null);
  useLayoutEffect(() => {
    let active = true;
    let opened: LocalWorkspace | undefined;
    // El propietario aísla usuarios: si cambia, la caché se vacía.
    // Se resuelve junto a la apertura del espacio local para no bloquear
    // el regreso con una pantalla de carga adicional.
    try {
      const identityPromise = (
        services as {
          authSession?: { getIdentity?: () => Promise<unknown> };
        }
      ).authSession?.getIdentity?.();
      if (!identityPromise) {
        setStudioClient(() => getStudioQueryClient(tenant.id, "anon"));
      } else {
        void identityPromise
          .then((identity) => {
            if (!active) return;
            const id = (identity as { id?: unknown }).id;
            const owner = studioCacheOwner(
              window.location.origin,
              String(id ?? "anon"),
            );
            setStudioQueryOwner(owner);
            setStudioClient(() => getStudioQueryClient(tenant.id, owner));
          })
          .catch(() => {
            if (!active) return;
            setStudioClient(() => getStudioQueryClient(tenant.id, "anon"));
          });
      }
    } catch {
      setStudioClient(() => getStudioQueryClient(tenant.id, "anon"));
    }
    const install = (local?: LocalWorkspace) => {
      if (!active) {
        local?.close();
        return;
      }
      opened = local;
      setStudioRuntime({
        embedded: true,
        tenantId: tenant.tenantId,
        businessSetupEnabled: tenant.tenantId !== 0,
        apiBasePath: tenant.apiBasePath,
        transport: local?.transport ?? transport,
        pluginTransport: transport,
        localWorkspace: local,
        publicFormTransport: (path, init) =>
          services.apiClient.requestResponse(path, init),
        requestTransport: (path, init) =>
          services.apiClient.requestResponse("/v1/request-pages" + path, init),
        navigate: (query, replace) => navigate.current(query, replace),
      });
      setWorkspace(local);
      setReadyTransport(() => transport);
    };
    if (pluginStudio) install();
    else if (services.localData) {
      void services.localData
        .open(tenant.apiBasePath)
        .then(install)
        .catch((error) => {
          if (active)
            setStartupError(
              error instanceof Error
                ? error.message
                : t("No se pudo abrir el espacio local."),
            );
        });
    } else install();
    return () => {
      active = false;
      // Al salir de Studio se cierra LocalWorkspace y sus suscripciones;
      // el cliente de consultas conservado no deja sincronizadores activos.
      opened?.close();
      setStudioRuntime({ embedded: false });
    };
  }, [transport, pluginStudio]);
  if (startupError)
    return (
      <div role="alert" className="p-4 text-sm text-destructive">
        {startupError}{" "}
        {t("Recarga para reintentar. No se guardaron cambios localmente.")}
      </div>
    );
  if (readyTransport !== transport || !studioClient)
    return <RouteLoading variant="screens" />;
  return (
    <div
      className={
        pluginStudio
          ? "-mx-3 -mb-6 flex min-h-0 min-w-0 flex-1 flex-col sm:-mx-4"
          : "min-w-0 w-full"
      }
      title={pluginStudio ? undefined : t("Studio")}
    >
      {workspace && <LocalSyncStatus workspace={workspace} />}
      {pluginStudio ? (
        <Suspense fallback={<RouteLoading variant="screens" />}>
          <PluginProjectWorkspace
            tenantId={tenant.tenantId}
            source={pluginSource}
            onSourceOpened={onPluginSourceOpened}
            onClose={onExitPluginStudio ?? (() => {})}
            onPublished={() => {}}
          />
        </Suspense>
      ) : (
        <Suspense fallback={<RouteLoading variant="screens" />}>
          <OfficeAvailabilityProvider
            apiClient={services.apiClient}
            tenantId={tenant.tenantId}
          >
            <StudioRoot embedded search={query} queryClient={studioClient} />
          </OfficeAvailabilityProvider>
        </Suspense>
      )}
    </div>
  );
}
