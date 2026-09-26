import { useMessages } from "@/i18n/core";
import { automationMessages } from "@/i18n/locales/automation";
import {
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";
import { useCanAccess } from "ra-core";
import { useSearchParams } from "react-router-dom";
import type { AppServices } from "@/app-services";
import { createEmbeddedTransport } from "@/api/embedded-transport";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Label } from "@/components/ui/label";
import { RouteLoading } from "@/components/admin/route-loading";
import { studioItems } from "./studio-navigation";
import {
  STUDIO_DOMAINS_CHANGED,
  listStudioDomains,
  selectStudioDomain,
  type StudioDomain,
} from "./studio-domains";
import { invalidateSharedDataDomains } from "@/api/domain-client";
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
const BusinessPanel = lazy(async () => {
  const module = await import("@/features/studio-engine/business-panel");
  return { default: module.BusinessPanel };
});

export function StudioPage({ services }: { services: AppServices }) {
  const t = useMessages(automationMessages);

  const { canAccess, isPending } = useCanAccess({
    resource: "studio",
    action: "list",
  });
  const [params, setParams] = useSearchParams();
  const [domains, setDomains] = useState<StudioDomain[]>([]);
  const [canCreateDomain, setCanCreateDomain] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [label, setLabel] = useState("");
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const saveInFlight = useRef(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const knownDomainIds = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!canAccess) return;
    let active = true;
    void services.authSession.getPermissions?.().then((permissions) => {
      if (active) setCanCreateDomain(Boolean(permissions?.canManageIdentity));
    });
    // Aislamiento entre usuarios: fija el propietario de la caché de Studio
    // y vacía todo si cambió de usuario.
    try {
      void services.authSession
        ?.getIdentity?.()
        ?.then((identity) => {
          if (!active) return;
          const id = (identity as { id?: unknown }).id;
          setStudioQueryOwner(
            studioCacheOwner(window.location.origin, String(id ?? "anon")),
          );
        })
        ?.catch(() => undefined);
    } catch {
      // Fuera del proveedor de servicios (tests): sin propietario.
    }
    let request = 0;
    const refreshDomains = () => {
      const currentRequest = ++request;
      void listStudioDomains(services)
        .then((result) => {
          if (active && currentRequest === request) {
            setDomains(result);
            setError("");
            // Elimina la caché del dominio eliminado sin tocar los demás.
            const ids = new Set(result.map((domain) => domain.id));
            if (knownDomainIds.current) {
              pruneStudioQueryCache(ids);
            }
            knownDomainIds.current = ids;
          }
        })
        .catch((cause) => {
          if (active && currentRequest === request)
            setError(
              cause instanceof Error
                ? cause.message
                : t("No se pudieron cargar los dominios."),
            );
        })
        .finally(
          () => active && currentRequest === request && setLoading(false),
        );
    };
    refreshDomains();
    window.addEventListener(STUDIO_DOMAINS_CHANGED, refreshDomains);
    return () => {
      active = false;
      window.removeEventListener(STUDIO_DOMAINS_CHANGED, refreshDomains);
    };
  }, [canAccess, services]);
  const selected = selectStudioDomain(
    domains,
    params.get("domain"),
    Number(params.get("agencyId")) || undefined,
  );
  useEffect(() => {
    if (!selected || params.get("domain") === selected.id) return;
    const next = new URLSearchParams(params);
    next.set("domain", selected.id);
    next.delete("agencyId");
    setParams(next, { replace: true });
  }, [selected?.id, params, setParams]);
  async function createDomain(event: React.FormEvent) {
    event.preventDefault();
    if (saveInFlight.current) return;
    saveInFlight.current = true;
    setSaving(true);
    setError("");
    try {
      const result = await services.apiClient.post<{ data: StudioDomain }>(
        "/v1/data-domains",
        { name, label },
      );
      invalidateSharedDataDomains();
      setDomains(await listStudioDomains(services));
      window.dispatchEvent(new Event(STUDIO_DOMAINS_CHANGED));
      setParams({ domain: result.data.id, view: "new-object" });
      setCreating(false);
      setContextOpen(false);
      setName("");
      setLabel("");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : t("No se pudo crear el dominio."),
      );
    } finally {
      saveInFlight.current = false;
      setSaving(false);
    }
  }
  function changeDomain(id: string) {
    const next = new URLSearchParams(params);
    if (id) next.set("domain", id);
    else next.delete("domain");
    next.delete("agencyId");
    next.delete("object");
    next.delete("view");
    setCreating(false);
    setContextOpen(false);
    setParams(next);
  }
  const requestedTool = studioItems.find(
    (item) => item.view === params.get("view"),
  );
  const headerActions =
    typeof document === "undefined"
      ? null
      : document.getElementById("header-actions");
  const domainContext = selected ? (
    <>
      <Popover
        open={contextOpen}
        onOpenChange={(open) => {
          setContextOpen(open);
          if (!open) setCreating(false);
        }}
      >
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="crm-domain-context-trigger h-8 min-w-0 max-w-[40vw] gap-1.5 px-2 sm:max-w-64"
            aria-label={t("Dominio: %{value0}", { value0: selected.label })}
            title={t("Dominio: %{value0}", { value0: selected.label })}
          >
            <span className="truncate">{selected.label}</span>
            <ChevronDown aria-hidden="true" className="shrink-0" size={16} />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          sideOffset={6}
          className="crm-domain-context-panel w-[min(20rem,92vw)] p-0"
        >
          <div className="border-b px-3 py-2.5">
            <p className="text-xs font-semibold text-foreground">
              {selected.label}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {t(
                "El dominio define qué formularios y registros ves en Studio. Cambia de entorno aquí sin salir de esta pantalla.",
              )}
            </p>
          </div>
          <div className="grid gap-3 p-3">
            <div className="grid gap-1.5">
              <Label htmlFor="crm-context-domain">
                {t("Dominio de datos")}
              </Label>
              <select
                id="crm-context-domain"
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                value={selected.id}
                onChange={(event) => changeDomain(event.target.value)}
              >
                {domains.map((domain) => (
                  <option value={domain.id} key={domain.id}>
                    {domain.label}
                  </option>
                ))}
              </select>
            </div>
            {canCreateDomain && (
              <div className="border-t pt-3">
                {creating ? (
                  <DomainCreationForm
                    label={label}
                    name={name}
                    saving={saving}
                    onLabelChange={setLabel}
                    onNameChange={setName}
                    onSubmit={createDomain}
                  />
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setCreating(true)}
                  >
                    {t("Crear dominio")}
                  </Button>
                )}
              </div>
            )}
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            {contextOpen && (
              <Suspense
                fallback={
                  <RouteLoading compact label={t("Cargando integraciones…")} />
                }
              >
                <BusinessPanel
                  className="rounded-md border p-3"
                  onInstalled={() =>
                    window.dispatchEvent(
                      new Event("savia-studio-objects-changed"),
                    )
                  }
                />
              </Suspense>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </>
  ) : null;
  if (isPending) return <RouteLoading variant="screens" />;
  if (!canAccess)
    return (
      <p role="alert">
        {t(
          "Studio está disponible para administradores de organización y plataforma.",
        )}
      </p>
    );
  return (
    <section className="@container min-w-0 w-full">
      {selected ? (
        headerActions && params.get("view") !== "audit" ? (
          createPortal(domainContext, headerActions)
        ) : null
      ) : (
        <>
          <header className="mb-2 flex flex-col gap-3 @min-[36rem]:flex-row @min-[36rem]:items-center">
            <h1 className="sr-only">{t("Studio")}</h1>
            <div className="grid min-w-0 flex-1 gap-1.5">
              <Label htmlFor="crm-domain">{t("Dominio de datos")}</Label>
              <select
                id="crm-domain"
                className="h-9 w-full min-w-0 max-w-full rounded-md border bg-background px-3 text-sm @min-[36rem]:max-w-md"
                value=""
                onChange={(event) => changeDomain(event.target.value)}
              >
                <option value="">{t("Selecciona un dominio")}</option>
                {domains.map((domain) => (
                  <option value={domain.id} key={domain.id}>
                    {domain.label}
                  </option>
                ))}
              </select>
            </div>
            {canCreateDomain && (
              <Button
                type="button"
                variant="outline"
                onClick={() => setCreating(!creating)}
              >
                {t("Crear dominio")}
              </Button>
            )}
          </header>
          {creating && (
            <DomainCreationForm
              className="mb-4 flex flex-wrap items-end gap-3 rounded-md border p-4"
              label={label}
              name={name}
              saving={saving}
              onLabelChange={setLabel}
              onNameChange={setName}
              onSubmit={createDomain}
            />
          )}
        </>
      )}
      {error && !selected ? (
        <p role="alert">{error}</p>
      ) : loading ? (
        <RouteLoading variant="screens" />
      ) : selected ? (
        <StudioWorkspace
          key={selected.id}
          services={services}
          domain={selected}
          query={(() => {
            const next = new URLSearchParams(params);
            next.set("domain", selected.id);
            next.delete("agencyId");
            return next.toString();
          })()}
          onNavigate={(query, replace) => {
            const next = new URLSearchParams(query);
            next.set("domain", selected.id);
            next.delete("agencyId");
            setParams(next, { replace });
          }}
        />
      ) : (
        <div className="py-8 text-muted-foreground">
          <h2 className="mb-2 text-lg font-semibold text-foreground">
            {requestedTool?.label ??
              (params.get("object") === "cotizaciones"
                ? t("Cotizaciones")
                : t("Clientes"))}
          </h2>
          <p>
            {domains.length
              ? t("Selecciona un dominio de datos disponible para trabajar.")
              : t(
                  "No tienes dominios de datos disponibles. Solicita acceso a un administrador.",
                )}
          </p>
        </div>
      )}
    </section>
  );
}

function DomainCreationForm({
  className,
  label,
  name,
  saving,
  onLabelChange,
  onNameChange,
  onSubmit,
}: {
  className?: string;
  label: string;
  name: string;
  saving: boolean;
  onLabelChange: (value: string) => void;
  onNameChange: (value: string) => void;
  onSubmit: (event: React.FormEvent) => void;
}) {
  const t = useMessages(automationMessages);

  return (
    <form onSubmit={onSubmit} className={className ?? "grid gap-3"}>
      <label className="grid gap-1 text-sm">
        {t("Nombre del dominio")}
        <input
          className="rounded-md border bg-background px-3 py-2"
          required
          value={label}
          onChange={(event) => onLabelChange(event.target.value)}
          placeholder={t("Operaciones")}
        />
      </label>
      <label className="grid gap-1 text-sm">
        {t("Identificador")}
        <input
          className="rounded-md border bg-background px-3 py-2"
          required
          pattern="[a-z][a-z0-9-]*"
          value={name}
          onChange={(event) => onNameChange(event.target.value)}
          placeholder={t("operaciones")}
        />
      </label>
      <Button disabled={saving} type="submit">
        {saving ? t("Creando…") : t("Guardar dominio")}
      </Button>
    </form>
  );
}

function StudioWorkspace({
  services,
  domain,
  query,
  onNavigate,
}: {
  services: AppServices;
  domain: StudioDomain;
  query: string;
  onNavigate: (query: string, replace?: boolean) => void;
}) {
  const t = useMessages(automationMessages);

  const navigate = useRef(onNavigate);
  navigate.current = onNavigate;
  const transport = useMemo(
    () => createEmbeddedTransport(services.apiClient, domain.apiBasePath),
    [domain.apiBasePath, services.apiClient],
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
        setStudioClient(() => getStudioQueryClient(domain.id, "anon"));
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
            setStudioClient(() => getStudioQueryClient(domain.id, owner));
          })
          .catch(() => {
            if (!active) return;
            setStudioClient(() => getStudioQueryClient(domain.id, "anon"));
          });
      }
    } catch {
      setStudioClient(() => getStudioQueryClient(domain.id, "anon"));
    }
    const install = (local?: LocalWorkspace) => {
      if (!active) {
        local?.close();
        return;
      }
      opened = local;
      setStudioRuntime({
        embedded: true,
        domainId: domain.id,
        businessSetupEnabled: domain.kind === "agency",
        apiBasePath: domain.apiBasePath,
        transport: local?.transport ?? transport,
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
    if (services.localData) {
      void services.localData
        .open(domain.apiBasePath)
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
  }, [transport]);
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
    <div className="min-w-0 w-full" title={t("Estudio del dominio de datos")}>
      {workspace && <LocalSyncStatus workspace={workspace} />}
      <Suspense fallback={<RouteLoading variant="screens" />}>
        <StudioRoot embedded search={query} queryClient={studioClient} />
      </Suspense>
    </div>
  );
}
