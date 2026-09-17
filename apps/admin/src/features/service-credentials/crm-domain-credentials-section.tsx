import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight } from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { AppServices } from "@/app-services";
import { createEmbeddedTransport } from "@/api/embedded-transport";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { crmHref } from "@/features/dynamic-crm/crm-navigation";
import {
  listCrmDomains,
  selectCrmDomain,
  type CrmDomain,
} from "@/features/dynamic-crm/crm-domains";
import { GeocodingSettingsPanel } from "@/features/crm-engine/geocoding-settings-panel";
import { setCrmRuntime } from "@/features/crm-engine/runtime";
import { api } from "@/features/crm-engine/api";
import {
  CredentialEntry,
  CredentialFreeServiceList,
  CredentialGroup,
  CredentialRequirementBadge,
  CredentialStatusBadge,
  formatConfiguredDate,
} from "./credential-registry";

type IntegrationSummary = {
  id: string;
  name: string;
  connection?: { mode?: string; authType?: string };
  hasSecret?: boolean;
  created_at?: string;
};

type GeocodingSettings = {
  geoapifyConfigured: boolean;
  geoapifyStored: boolean;
  updatedAt?: string | null;
};

function CredentialTab({
  value,
  tooltip,
  children,
  disabled,
}: {
  value: string;
  tooltip: string;
  children: ReactNode;
  disabled?: boolean;
}) {
  const trigger = (
    <TabsTrigger value={value} disabled={disabled}>
      {children}
    </TabsTrigger>
  );
  if (disabled) return trigger;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{trigger}</TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6} className="max-w-xs">
        {tooltip}
      </TooltipContent>
    </Tooltip>
  );
}

function GlobalCredentialsPanel({
  globalCredentials,
  geoapifyEntry,
  freeServicesEntry,
  loadingMessage,
}: {
  globalCredentials?: ReactNode;
  geoapifyEntry?: ReactNode;
  freeServicesEntry: ReactNode;
  loadingMessage?: ReactNode;
}) {
  return (
    <CredentialGroup
      title="Credenciales globales"
      description="Una clave por espacio. Solo se usa cuando activas el servicio correspondiente."
    >
      {globalCredentials}
      {loadingMessage}
      {geoapifyEntry}
      {freeServicesEntry}
    </CredentialGroup>
  );
}

function FreeServicesEntry() {
  return (
    <CredentialEntry
      title="Proveedores de mapas gratuitos"
      description="Photon y Nominatim cubren autocompletar de direcciones sin registrar credenciales."
      requirement="none"
    >
      <CredentialFreeServiceList
        items={[
          {
            name: "Photon (Komoot)",
            detail: "Búsqueda de direcciones sin API key.",
          },
          {
            name: "Nominatim (OpenStreetMap)",
            detail: "Geocodificación abierta sin registro previo.",
          },
        ]}
      />
    </CredentialEntry>
  );
}

function integrationStatus(item: IntegrationSummary): {
  configured: boolean;
  label: string;
} {
  if (item.connection?.mode === "external") {
    if (item.connection.authType === "none") {
      return { configured: true, label: "Sin autenticación" };
    }
    if (item.hasSecret) {
      return { configured: true, label: "Credencial guardada" };
    }
    return { configured: false, label: "Falta credencial" };
  }
  if (item.connection?.mode === "demo") {
    return { configured: true, label: "Modo demo" };
  }
  return { configured: false, label: "Sin conexión" };
}

export function CrmDomainCredentialsSection({
  services,
  globalCredentials,
}: {
  services: Pick<AppServices, "apiClient">;
  globalCredentials?: ReactNode;
}) {
  const navigate = useNavigate();
  const [domains, setDomains] = useState<CrmDomain[]>([]);
  const [loadingDomains, setLoadingDomains] = useState(true);
  const domain = useMemo(
    () => selectCrmDomain(domains, "platform") ?? domains[0],
    [domains],
  );
  const transport = useMemo(
    () =>
      domain
        ? createEmbeddedTransport(services.apiClient, domain.apiBasePath)
        : null,
    [domain, services.apiClient],
  );
  const fallbackObject = "cotizador";

  useEffect(() => {
    if (!services.apiClient?.get) {
      setLoadingDomains(false);
      return;
    }
    let active = true;
    void listCrmDomains(services as AppServices)
      .then((result) => {
        if (active) setDomains(result);
      })
      .finally(() => {
        if (active) setLoadingDomains(false);
      });
    return () => {
      active = false;
    };
  }, [services]);

  useLayoutEffect(() => {
    if (!domain || !transport) return;
    setCrmRuntime({
      embedded: true,
      domainId: domain.id,
      apiBasePath: domain.apiBasePath,
      transport,
    });
    return () => setCrmRuntime({ embedded: false });
  }, [domain, transport]);

  const integrations = useQuery({
    queryKey: ["integrations", domain?.id],
    queryFn: () => api<{ data: IntegrationSummary[] }>("/integrations"),
    enabled: !!transport,
  });

  const geocoding = useQuery({
    queryKey: ["geocoding-settings", domain?.id],
    queryFn: () => api<GeocodingSettings>("/settings/geocoding"),
    enabled: !!transport,
  });

  if (loadingDomains) {
    return (
      <Tabs defaultValue="global" className="credentials-tabs">
        <TabsList className="credentials-tabs-list">
          <CredentialTab
            value="global"
            tooltip="Una clave por espacio para IA y servicios opcionales como Geoapify."
          >
            Globales
          </CredentialTab>
          <CredentialTab value="integrations" tooltip="" disabled>
            Integraciones
          </CredentialTab>
        </TabsList>
        <TabsContent value="global" className="credentials-tabs-panel">
          <GlobalCredentialsPanel
            globalCredentials={globalCredentials}
            freeServicesEntry={<FreeServicesEntry />}
            loadingMessage={
              <p className="credentials-muted">
                Cargando mapas e integraciones…
              </p>
            }
          />
        </TabsContent>
      </Tabs>
    );
  }

  if (!domain || !transport) {
    return (
      <Tabs defaultValue="global" className="credentials-tabs">
        <TabsList className="credentials-tabs-list">
          <CredentialTab
            value="global"
            tooltip="Una clave por espacio para IA y servicios opcionales como Geoapify."
          >
            Globales
          </CredentialTab>
          <CredentialTab value="integrations" tooltip="" disabled>
            Integraciones
          </CredentialTab>
        </TabsList>
        <TabsContent value="global" className="credentials-tabs-panel">
          <GlobalCredentialsPanel
            globalCredentials={globalCredentials}
            freeServicesEntry={<FreeServicesEntry />}
            loadingMessage={
              <p className="credentials-muted">
                No hay dominios de datos disponibles para Geoapify o
                integraciones del CRM.
              </p>
            }
          />
        </TabsContent>
      </Tabs>
    );
  }

  const configuredIntegrations =
    integrations.data?.data.filter(
      (item) =>
        item.connection?.mode === "external" &&
        (item.hasSecret || item.connection?.authType === "none"),
    ) ?? [];
  const pendingIntegrations =
    integrations.data?.data.filter(
      (item) =>
        item.connection?.mode === "external" &&
        item.connection?.authType !== "none" &&
        !item.hasSecret,
    ) ?? [];
  const domainTools = domain.apiBasePath.startsWith("/v1/data-domains/");
  const geoapifyConfigured =
    geocoding.data?.geoapifyStored || geocoding.data?.geoapifyConfigured;

  const geoapifyEntry = (
    <CredentialEntry
      title="Geoapify"
      description="Autocompletar de direcciones en el diseñador cuando eliges Geoapify como proveedor."
      requirement="optional"
      status={
        geocoding.isLoading ? null : (
          <CredentialStatusBadge
            configured={Boolean(geoapifyConfigured)}
            label={
              geocoding.data?.geoapifyStored
                ? "Clave guardada"
                : geocoding.data?.geoapifyConfigured
                  ? "Disponible en servidor"
                  : "Sin clave"
            }
          />
        )
      }
    >
      <GeocodingSettingsPanel />
    </CredentialEntry>
  );

  const integrationsPanel = (
    <CredentialGroup
      title="Por integración"
      description="Cada OpenAPI externa guarda su URL base y credencial por separado."
    >
      <CredentialEntry
        title="Integraciones OpenAPI del CRM"
        description="Revisa qué conexiones externas ya tienen credencial y cuáles siguen pendientes."
        requirement="per-item"
        status={
          integrations.isLoading ? null : integrations.data?.data.length ? (
            <CredentialStatusBadge
              configured={pendingIntegrations.length === 0}
              label={
                pendingIntegrations.length === 0
                  ? `${configuredIntegrations.length} listas`
                  : `${pendingIntegrations.length} pendientes`
              }
            />
          ) : null
        }
      >
        {integrations.isLoading ? (
          <p className="credentials-muted">Cargando integraciones…</p>
        ) : integrations.error ? (
          <p className="credentials-error" role="alert">
            {integrations.error.message}
          </p>
        ) : integrations.data?.data.length ? (
          <>
            <ul className="credentials-list">
              {integrations.data.data.map((item) => {
                const status = integrationStatus(item);
                return (
                  <li key={item.id}>
                    <div className="credentials-list-copy">
                      <strong>{item.name}</strong>
                      <span className="credentials-list-meta">
                        {status.label}
                        {item.hasSecret && item.created_at
                          ? ` • Configurada el ${formatConfiguredDate(item.created_at)}`
                          : ""}
                      </span>
                    </div>
                    <CredentialRequirementBadge
                      kind={
                        item.connection?.mode === "external" &&
                        item.connection.authType !== "none"
                          ? "required"
                          : "none"
                      }
                    />
                  </li>
                );
              })}
            </ul>
            {(pendingIntegrations.length > 0 ||
              configuredIntegrations.length > 0) && (
              <p className="credentials-summary-line">
                {configuredIntegrations.length} con credencial ·{" "}
                {pendingIntegrations.length} pendientes
              </p>
            )}
          </>
        ) : (
          <p className="credentials-muted">
            Aún no importaste integraciones en este dominio.
          </p>
        )}
        <div className="credentials-entry-actions">
          <Button
            variant="outline"
            onClick={() =>
              navigate(
                crmHref({
                  domain: domain.id,
                  object: fallbackObject,
                  view: "integrations",
                }),
              )
            }
          >
            Administrar integraciones
            <ArrowUpRight size={15} aria-hidden="true" />
          </Button>
        </div>
      </CredentialEntry>
    </CredentialGroup>
  );

  const sourcesPanel = domainTools ? (
    <CredentialGroup
      title="Por fuente"
      description="Los tokens JSON:API se guardan en cada fuente, no de forma global."
    >
      <CredentialEntry
        title="Fuentes de datos externas"
        description="Conecta recursos remotos y define el token de acceso por fuente."
        requirement="per-item"
      >
        <div className="credentials-entry-actions">
          <Button
            variant="outline"
            onClick={() =>
              navigate(
                crmHref({
                  domain: domain.id,
                  object: fallbackObject,
                  view: "collection-sources",
                }),
              )
            }
          >
            Administrar fuentes de datos
            <ArrowUpRight size={15} aria-hidden="true" />
          </Button>
        </div>
      </CredentialEntry>
    </CredentialGroup>
  ) : null;

  return (
    <Tabs defaultValue="global" className="credentials-tabs">
      <TabsList className="credentials-tabs-list">
        <CredentialTab
          value="global"
          tooltip="Una clave por espacio para IA y servicios opcionales como Geoapify."
        >
          Globales
        </CredentialTab>
        <CredentialTab
          value="integrations"
          tooltip="Cada OpenAPI externa guarda su URL y credencial por separado."
        >
          Integraciones
          {pendingIntegrations.length > 0 ? (
            <Badge className="ml-1.5" variant="secondary">
              {pendingIntegrations.length}
            </Badge>
          ) : null}
        </CredentialTab>
        {domainTools ? (
          <CredentialTab
            value="sources"
            tooltip="Los tokens JSON:API se configuran en cada fuente de datos."
          >
            Fuentes
          </CredentialTab>
        ) : null}
      </TabsList>

      <TabsContent value="global" className="credentials-tabs-panel">
        <GlobalCredentialsPanel
          globalCredentials={globalCredentials}
          geoapifyEntry={geoapifyEntry}
          freeServicesEntry={<FreeServicesEntry />}
        />
      </TabsContent>

      <TabsContent value="integrations" className="credentials-tabs-panel">
        {integrationsPanel}
      </TabsContent>

      {domainTools ? (
        <TabsContent value="sources" className="credentials-tabs-panel">
          {sourcesPanel}
        </TabsContent>
      ) : null}
    </Tabs>
  );
}
