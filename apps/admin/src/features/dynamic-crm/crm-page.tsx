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
import { crmStudioItems } from "./crm-navigation";
import {
  CRM_DOMAINS_CHANGED,
  listCrmDomains,
  selectCrmDomain,
  type CrmDomain,
} from "./crm-domains";
import { setCrmRuntime } from "@/features/crm-engine/runtime";
import { LocalSyncStatus } from "@/local-data/sync-status";
import type { LocalWorkspace } from "@/local-data/workspaces";
import "./embedded.css";

const CrmRoot = lazy(() => import("@/features/crm-engine/app"));
const BusinessPanel = lazy(async () => {
  const module = await import("@/features/crm-engine/business-panel");
  return { default: module.BusinessPanel };
});

export function CrmPage({ services }: { services: AppServices }) {
  const { canAccess, isPending } = useCanAccess({
    resource: "dynamic-crm",
    action: "list",
  });
  const [params, setParams] = useSearchParams();
  const [domains, setDomains] = useState<CrmDomain[]>([]);
  const [canCreateDomain, setCanCreateDomain] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [label, setLabel] = useState("");
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const saveInFlight = useRef(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!canAccess) return;
    let active = true;
    void services.authSession.getPermissions?.().then((permissions) => {
      if (active) setCanCreateDomain(Boolean(permissions?.canManageIdentity));
    });
    let request = 0;
    const refreshDomains = () => {
      const currentRequest = ++request;
      void listCrmDomains(services)
        .then((result) => {
          if (active && currentRequest === request) {
            setDomains(result);
            setError("");
          }
        })
        .catch((cause) => {
          if (active && currentRequest === request)
            setError(
              cause instanceof Error
                ? cause.message
                : "No se pudieron cargar los dominios.",
            );
        })
        .finally(
          () => active && currentRequest === request && setLoading(false),
        );
    };
    refreshDomains();
    window.addEventListener(CRM_DOMAINS_CHANGED, refreshDomains);
    return () => {
      active = false;
      window.removeEventListener(CRM_DOMAINS_CHANGED, refreshDomains);
    };
  }, [canAccess, services]);
  const selected = selectCrmDomain(
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
      const result = await services.apiClient.post<{ data: CrmDomain }>(
        "/v1/data-domains",
        { name, label },
      );
      setDomains(await listCrmDomains(services));
      window.dispatchEvent(new Event(CRM_DOMAINS_CHANGED));
      setParams({ domain: result.data.id, view: "new-object" });
      setCreating(false);
      setContextOpen(false);
      setName("");
      setLabel("");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "No se pudo crear el dominio.",
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
  const requestedTool = crmStudioItems.find(
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
            size="icon"
            className="crm-domain-context-trigger size-8 shrink-0"
            aria-label={`Dominio: ${selected.label}`}
            title={`Dominio: ${selected.label}`}
          >
            <ChevronDown aria-hidden="true" size={16} />
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
              El dominio define qué formularios y registros ves en el CRM.
              Cambia de entorno aquí sin salir de esta pantalla.
            </p>
          </div>
          <div className="grid gap-3 p-3">
            <div className="grid gap-1.5">
              <Label htmlFor="crm-context-domain">Dominio de datos</Label>
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
                    Crear dominio
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
                  <RouteLoading compact label="Cargando integraciones…" />
                }
              >
                <BusinessPanel
                  className="rounded-md border p-3"
                  onInstalled={() =>
                    window.dispatchEvent(new Event("savia-crm-objects-changed"))
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
        El CRM está disponible para administradores de agencia y plataforma.
      </p>
    );
  return (
    <section className="@container min-w-0 w-full">
      {selected ? (
        headerActions ? (
          createPortal(domainContext, headerActions)
        ) : null
      ) : (
        <>
          <header className="mb-2 flex flex-col gap-3 @min-[36rem]:flex-row @min-[36rem]:items-center">
            <h1 className="sr-only">CRM</h1>
            <div className="grid min-w-0 flex-1 gap-1.5">
              <Label htmlFor="crm-domain">Dominio de datos</Label>
              <select
                id="crm-domain"
                className="h-9 w-full min-w-0 max-w-full rounded-md border bg-background px-3 text-sm @min-[36rem]:max-w-md"
                value=""
                onChange={(event) => changeDomain(event.target.value)}
              >
                <option value="">Selecciona un dominio</option>
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
                Crear dominio
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
        <CrmWorkspace
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
                ? "Cotizaciones"
                : "Clientes")}
          </h2>
          <p>
            {domains.length
              ? "Selecciona un dominio de datos disponible para trabajar."
              : "No tienes dominios de datos disponibles. Solicita acceso a un administrador."}
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
  return (
    <form onSubmit={onSubmit} className={className ?? "grid gap-3"}>
      <label className="grid gap-1 text-sm">
        Nombre del dominio
        <input
          className="rounded-md border bg-background px-3 py-2"
          required
          value={label}
          onChange={(event) => onLabelChange(event.target.value)}
          placeholder="Operaciones"
        />
      </label>
      <label className="grid gap-1 text-sm">
        Identificador
        <input
          className="rounded-md border bg-background px-3 py-2"
          required
          pattern="[a-z][a-z0-9-]*"
          value={name}
          onChange={(event) => onNameChange(event.target.value)}
          placeholder="operaciones"
        />
      </label>
      <Button disabled={saving} type="submit">
        {saving ? "Creando…" : "Guardar dominio"}
      </Button>
    </form>
  );
}

function CrmWorkspace({
  services,
  domain,
  query,
  onNavigate,
}: {
  services: AppServices;
  domain: CrmDomain;
  query: string;
  onNavigate: (query: string, replace?: boolean) => void;
}) {
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
  useLayoutEffect(() => {
    let active = true;
    let opened: LocalWorkspace | undefined;
    const install = (local?: LocalWorkspace) => {
      if (!active) {
        local?.close();
        return;
      }
      opened = local;
      setCrmRuntime({
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
                : "No se pudo abrir el espacio local.",
            );
        });
    } else install();
    return () => {
      active = false;
      opened?.close();
      setCrmRuntime({ embedded: false });
    };
  }, [transport]);
  if (startupError)
    return (
      <div role="alert" className="p-4 text-sm text-destructive">
        {startupError} Recarga para reintentar. No se guardaron cambios
        localmente.
      </div>
    );
  if (readyTransport !== transport) return <RouteLoading variant="screens" />;
  return (
    <div className="min-w-0 w-full" title="Estudio del dominio de datos">
      {workspace && <LocalSyncStatus workspace={workspace} />}
      <Suspense fallback={<RouteLoading variant="screens" />}>
        <CrmRoot embedded search={query} />
      </Suspense>
    </div>
  );
}
