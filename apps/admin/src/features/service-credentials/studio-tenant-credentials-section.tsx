import { OfficeSettingsPanel } from "@/features/office-settings/office-settings-panel";
import { officeSuiteMessages } from "@/features/office-suite/messages";
import { useRealtimeRefresh } from "@/realtime/use-realtime-refresh";
import { useMessages, useAppLocale, intlLocale } from "@/i18n/core";
import { settingsMessages } from "@/i18n/locales/settings";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { AppServices } from "@/app-services";
import { createEmbeddedTransport } from "@/api/embedded-transport";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { studioHref } from "@/features/studio/studio-navigation";
import {
  listStudioTenants,
  selectStudioTenant,
  type StudioTenant,
} from "@/features/studio/studio-tenants";
import { GeocodingSettingsPanel } from "@/features/studio-engine/geocoding-settings-panel";
import { TenantEmailSettingsPanel } from "@/features/tenant-email/tenant-email-settings-panel";
import { tenantEmailMessages } from "@/features/tenant-email/tenant-email-messages";
import { TenantSSOSettingsPanel } from "@/features/tenant-sso/tenant-sso-settings-panel";
import { tenantSSOMessages } from "@/features/tenant-sso/tenant-sso-messages";
import { tenantSignInMessages } from "@/features/tenant-sso/tenant-sign-in-messages";
import { TenantSocialSettingsPanel } from "@/features/tenant-social/tenant-social-settings-panel";
import { tenantSocialMessages } from "@/features/tenant-social/tenant-social-messages";
import { TenantRegistrationSettingsPanel } from "@/features/tenant-registration/tenant-registration-settings-panel";
import { tenantRegistrationMessages } from "@/features/tenant-registration/tenant-registration-messages";
import { setStudioRuntime } from "@/features/studio-engine/runtime";
import { api } from "@/features/studio-engine/api";
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
  const t = useMessages(settingsMessages);
  return (
    <>
      {globalCredentials}
      <CredentialGroup
        title={t("Workspace credentials")}
        description={t(
          "Una clave por espacio. Solo se usa cuando activas el servicio correspondiente.",
        )}
        descriptionAsTooltip
      >
        {loadingMessage}
        {geoapifyEntry}
        {freeServicesEntry}
      </CredentialGroup>
    </>
  );
}

function FreeServicesEntry() {
  const t = useMessages(settingsMessages);
  return (
    <CredentialEntry
      title={t("Proveedores de mapas gratuitos")}
      description={t(
        "Photon y Nominatim cubren autocompletar de direcciones sin registrar credenciales.",
      )}
      requirement="none"
    >
      <CredentialFreeServiceList
        items={[
          {
            name: "Photon (Komoot)",
            detail: t("Búsqueda de direcciones sin API key."),
          },
          {
            name: "Nominatim (OpenStreetMap)",
            detail: t("Geocodificación abierta sin registro previo."),
          },
        ]}
      />
    </CredentialEntry>
  );
}

function integrationStatus(item: IntegrationSummary): {
  configured: boolean;
  label: keyof typeof settingsMessages;
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

export function StudioTenantCredentialsSection({
  services,
  globalCredentials,
}: {
  services: Pick<AppServices, "apiClient">;
  globalCredentials?: ReactNode;
}) {
  const t = useMessages(settingsMessages);
  const officeT = useMessages(officeSuiteMessages);
  const emailT = useMessages(tenantEmailMessages);
  const ssoT = useMessages(tenantSSOMessages);
  const socialT = useMessages(tenantSocialMessages);
  const registrationT = useMessages(tenantRegistrationMessages);
  const signInT = useMessages(tenantSignInMessages);
  const locale = intlLocale(useAppLocale());
  const navigate = useNavigate();
  const cache = useQueryClient();
  const [tenants, setTenants] = useState<StudioTenant[]>([]);
  const [loadingTenants, setLoadingTenants] = useState(true);
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTenantId = searchParams.get("tenantId");
  const selectedTenantId =
    requestedTenantId === null
      ? undefined
      : /^\d+$/.test(requestedTenantId) &&
          Number.isSafeInteger(Number(requestedTenantId))
        ? Number(requestedTenantId)
        : NaN;
  const setSelectedTenantId = (tenantId: number) => {
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      next.set("tenantId", String(tenantId));
      return next;
    });
  };
  const tenant = useMemo(
    () =>
      selectStudioTenant(tenants, selectedTenantId) ??
      (selectedTenantId === undefined
        ? (selectStudioTenant(tenants, 0) ?? tenants[0])
        : undefined),
    [tenants, selectedTenantId],
  );
  const transport = useMemo(
    () =>
      tenant
        ? createEmbeddedTransport(services.apiClient, tenant.apiBasePath)
        : null,
    [tenant, services.apiClient],
  );
  const fallbackObject = "cotizador";

  useEffect(() => {
    if (!services.apiClient?.get) {
      setLoadingTenants(false);
      return;
    }
    let active = true;
    void listStudioTenants(services as AppServices)
      .then((result) => {
        if (active) setTenants(result);
      })
      .finally(() => {
        if (active) setLoadingTenants(false);
      });
    return () => {
      active = false;
    };
  }, [services]);

  useLayoutEffect(() => {
    if (!tenant || !transport) return;
    setStudioRuntime({
      embedded: true,
      tenantId: tenant.tenantId,
      apiBasePath: tenant.apiBasePath,
      transport,
    });
    return () => setStudioRuntime({ embedded: false });
  }, [tenant, transport]);

  const integrations = useQuery({
    queryKey: ["integrations", tenant?.id],
    queryFn: () => api<{ data: IntegrationSummary[] }>("/integrations"),
    enabled: !!transport,
  });

  const geocoding = useQuery({
    queryKey: ["geocoding-settings", tenant?.id],
    queryFn: () => api<GeocodingSettings>("/settings/geocoding"),
    enabled: !!transport,
  });

  useRealtimeRefresh({
    topics: ["settings", "integrations"],
    tenantId: tenant?.tenantId,
    enabled: !!tenant,
    refresh: async () => {
      await Promise.all([
        cache.invalidateQueries({ queryKey: ["integrations"] }),
        cache.invalidateQueries({ queryKey: ["geocoding-settings"] }),
      ]);
    },
  });

  if (loadingTenants) {
    return (
      <Tabs defaultValue="global" className="credentials-tabs">
        <TabsList className="credentials-tabs-list">
          <CredentialTab
            value="global"
            tooltip={t(
              "Service credentials, grouped by platform or workspace.",
            )}
          >
            {t("Services")}
          </CredentialTab>
          <CredentialTab value="integrations" tooltip="" disabled>
            {t("Integraciones")}
          </CredentialTab>
          <CredentialTab
            value="email"
            tooltip={emailT("Tenant email delivery")}
            disabled
          >
            {emailT("Tenant email delivery")}
          </CredentialTab>
          <CredentialTab value="sso" tooltip={ssoT("Tenant SAML SSO")} disabled>
            {ssoT("Tenant SAML SSO")}
          </CredentialTab>
          <CredentialTab
            value="social"
            tooltip={socialT("Social sign-in")}
            disabled
          >
            {socialT("Social sign-in")}
          </CredentialTab>
          <CredentialTab
            value="registration"
            tooltip={registrationT("User registration")}
            disabled
          >
            {registrationT("User registration")}
          </CredentialTab>
        </TabsList>
        <TabsContent value="global" className="credentials-tabs-panel">
          <GlobalCredentialsPanel
            globalCredentials={globalCredentials}
            freeServicesEntry={<FreeServicesEntry />}
            loadingMessage={
              <div
                className="space-y-2 py-2"
                role="status"
                aria-label={t("Cargando mapas e integraciones…")}
              >
                <span className="sr-only">
                  {t("Cargando mapas e integraciones…")}
                </span>
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-9 w-full max-w-sm rounded-md" />
              </div>
            }
          />
        </TabsContent>
      </Tabs>
    );
  }

  if (!tenant || !transport) {
    return (
      <div>
        {requestedTenantId !== null && !loadingTenants ? (
          <p role="alert" className="text-sm text-destructive">
            {signInT(
              "The requested workspace is unavailable. Select another workspace to continue.",
            )}
          </p>
        ) : null}
        {tenants.length > 0 ? (
          <label className="mt-3 grid max-w-sm gap-1.5 text-sm">
            {t("Workspace")}
            <select
              className="h-9 rounded-md border bg-background px-3"
              value=""
              onChange={(event) =>
                setSelectedTenantId(Number(event.target.value))
              }
            >
              <option value="" disabled>
                {t("Workspace")}
              </option>
              {tenants.map((item) => (
                <option key={item.id} value={item.tenantId}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <Tabs defaultValue="global" className="credentials-tabs">
          <TabsList className="credentials-tabs-list">
            <CredentialTab
              value="global"
              tooltip={t(
                "Service credentials, grouped by platform or workspace.",
              )}
            >
              {t("Services")}
            </CredentialTab>
            <CredentialTab value="integrations" tooltip="" disabled>
              {t("Integraciones")}
            </CredentialTab>
            <CredentialTab
              value="email"
              tooltip={emailT("Tenant email delivery")}
              disabled
            >
              {emailT("Tenant email delivery")}
            </CredentialTab>
            <CredentialTab
              value="sso"
              tooltip={ssoT("Tenant SAML SSO")}
              disabled
            >
              {ssoT("Tenant SAML SSO")}
            </CredentialTab>
            <CredentialTab
              value="social"
              tooltip={socialT("Social sign-in")}
              disabled
            >
              {socialT("Social sign-in")}
            </CredentialTab>
            <CredentialTab
              value="registration"
              tooltip={registrationT("User registration")}
              disabled
            >
              {registrationT("User registration")}
            </CredentialTab>
          </TabsList>
          <TabsContent value="global" className="credentials-tabs-panel">
            <GlobalCredentialsPanel
              globalCredentials={globalCredentials}
              freeServicesEntry={<FreeServicesEntry />}
              loadingMessage={
                <p className="credentials-muted">
                  {t(
                    "No hay tenants disponibles para Geoapify o integraciones de Studio.",
                  )}
                </p>
              }
            />
          </TabsContent>
        </Tabs>
      </div>
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
  const tenantTools = true;
  const isPlatformWorkspace = tenant.tenantId === 0;
  const requestedTab = searchParams.get("tab") ?? "global";
  const activeTab = [
    "global",
    "integrations",
    "sources",
    "email",
    ...(!isPlatformWorkspace
      ? ["office", "sso", "social", "registration"]
      : []),
  ].includes(requestedTab)
    ? requestedTab
    : "global";
  const geoapifyConfigured =
    geocoding.data?.geoapifyStored || geocoding.data?.geoapifyConfigured;

  const geoapifyEntry = (
    <CredentialEntry
      title="Geoapify"
      description={t(
        "Autocompletar de direcciones en el diseñador cuando eliges Geoapify como proveedor.",
      )}
      requirement="optional"
      status={
        geocoding.isLoading ? null : (
          <CredentialStatusBadge
            configured={Boolean(geoapifyConfigured)}
            label={
              geocoding.data?.geoapifyStored
                ? t("Clave guardada")
                : geocoding.data?.geoapifyConfigured
                  ? t("Disponible en servidor")
                  : t("Sin clave")
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
      title={t("Por integración")}
      description={t(
        "Cada OpenAPI externa guarda su URL base y credencial por separado.",
      )}
    >
      <CredentialEntry
        title={t("Integraciones OpenAPI de Studio")}
        description={t(
          "Revisa qué conexiones externas ya tienen credencial y cuáles siguen pendientes.",
        )}
        requirement="per-item"
        status={
          integrations.isLoading ? null : integrations.data?.data.length ? (
            <CredentialStatusBadge
              configured={pendingIntegrations.length === 0}
              label={
                pendingIntegrations.length === 0
                  ? t("%{count} listas", {
                      count: configuredIntegrations.length,
                    })
                  : t("%{count} pendientes", {
                      count: pendingIntegrations.length,
                    })
              }
            />
          ) : null
        }
      >
        {integrations.isLoading ? (
          <div
            className="space-y-2 py-2"
            role="status"
            aria-label={t("Cargando integraciones…")}
          >
            <span className="sr-only">{t("Cargando integraciones…")}</span>
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-9 w-full max-w-sm rounded-md" />
          </div>
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
                        {t(status.label)}
                        {item.hasSecret && item.created_at
                          ? ` • ${t("Configurado el %{date}", { date: formatConfiguredDate(item.created_at, locale) })}`
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
                {t("%{configured} con credencial · %{pending} pendientes", {
                  configured: configuredIntegrations.length,
                  pending: pendingIntegrations.length,
                })}
              </p>
            )}
          </>
        ) : (
          <p className="credentials-muted">
            {t("Aún no importaste integraciones en este tenant.")}
          </p>
        )}
        <div className="credentials-entry-actions">
          <Button
            variant="outline"
            onClick={() =>
              navigate(
                studioHref({
                  tenantId: tenant.tenantId,
                  object: fallbackObject,
                  view: "collection-sources",
                  tab: "integrations",
                }),
              )
            }
          >
            {t("Administrar integraciones")}
            <ArrowUpRight size={15} aria-hidden="true" />
          </Button>
        </div>
      </CredentialEntry>
    </CredentialGroup>
  );

  const sourcesPanel = tenantTools ? (
    <CredentialGroup
      title={t("Por fuente")}
      description={t(
        "Los tokens JSON:API se guardan en cada fuente, no de forma global.",
      )}
    >
      <CredentialEntry
        title={t("Fuentes de datos externas")}
        description={t(
          "Conecta recursos remotos y define el token de acceso por fuente.",
        )}
        requirement="per-item"
      >
        <div className="credentials-entry-actions">
          <Button
            variant="outline"
            onClick={() =>
              navigate(
                studioHref({
                  tenantId: tenant.tenantId,
                  object: fallbackObject,
                  view: "collection-sources",
                }),
              )
            }
          >
            {t("Administrar fuentes de datos")}
            <ArrowUpRight size={15} aria-hidden="true" />
          </Button>
        </div>
      </CredentialEntry>
    </CredentialGroup>
  ) : null;

  return (
    <div className="grid gap-3">
      {tenants.length > 1 && (
        <label className="grid max-w-sm gap-1.5 text-sm">
          {t("Workspace")}
          <select
            className="h-9 rounded-md border bg-background px-3"
            value={String(tenant.tenantId)}
            onChange={(event) => {
              setSelectedTenantId(Number(event.target.value));
            }}
          >
            {tenants.map((item) => (
              <option key={item.id} value={item.tenantId}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {isPlatformWorkspace ? (
        <p className="max-w-2xl text-sm text-muted-foreground">
          {socialT(
            "SSO and social sign-in are configured per tenant. Select a tenant workspace to manage its sign-in methods.",
          )}
        </p>
      ) : null}
      <Tabs
        value={activeTab}
        onValueChange={(tab) => {
          setSearchParams((previous) => {
            const next = new URLSearchParams(previous);
            next.set("tab", tab);
            next.set("tenantId", String(tenant.tenantId));
            return next;
          });
        }}
        className="credentials-tabs"
      >
        <TabsList className="credentials-tabs-list">
          <CredentialTab
            value="global"
            tooltip={t(
              "Service credentials, grouped by platform or workspace.",
            )}
          >
            {t("Services")}
          </CredentialTab>
          <CredentialTab
            value="integrations"
            tooltip={t(
              "Cada OpenAPI externa guarda su URL y credencial por separado.",
            )}
          >
            {t("Integraciones")}
            {pendingIntegrations.length > 0 ? (
              <Badge className="ml-1.5" variant="secondary">
                {pendingIntegrations.length}
              </Badge>
            ) : null}
          </CredentialTab>
          {tenantTools ? (
            <CredentialTab
              value="sources"
              tooltip={t(
                "Los tokens JSON:API se configuran en cada fuente de datos.",
              )}
            >
              {t("Fuentes")}
            </CredentialTab>
          ) : null}
          <CredentialTab
            value="email"
            tooltip={emailT("Tenant email delivery")}
          >
            {emailT("Tenant email delivery")}
          </CredentialTab>
          {!isPlatformWorkspace && (
            <CredentialTab value="office" tooltip={officeT("Office suite")}>
              {officeT("Office suite")}
            </CredentialTab>
          )}
          {!isPlatformWorkspace ? (
            <>
              <CredentialTab value="sso" tooltip={ssoT("Tenant SAML SSO")}>
                {ssoT("Tenant SAML SSO")}
              </CredentialTab>
              <CredentialTab value="social" tooltip={socialT("Social sign-in")}>
                {socialT("Social sign-in")}
              </CredentialTab>
              <CredentialTab
                value="registration"
                tooltip={registrationT("User registration")}
              >
                {registrationT("User registration")}
              </CredentialTab>
            </>
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

        {tenantTools ? (
          <TabsContent value="sources" className="credentials-tabs-panel">
            {sourcesPanel}
          </TabsContent>
        ) : null}
        {!isPlatformWorkspace && (
          <TabsContent value="office" className="credentials-tabs-panel">
            <OfficeSettingsPanel
              key={tenant.tenantId}
              tenantId={tenant.tenantId}
              services={services}
            />
          </TabsContent>
        )}
        <TabsContent value="email" className="credentials-tabs-panel">
          <TenantEmailSettingsPanel
            key={tenant.tenantId}
            tenantId={tenant.tenantId}
            services={services}
          />
        </TabsContent>
        {!isPlatformWorkspace ? (
          <>
            <TabsContent value="sso" className="credentials-tabs-panel">
              <TenantSSOSettingsPanel
                key={tenant.tenantId}
                tenantId={tenant.tenantId}
                services={services}
              />
            </TabsContent>
            <TabsContent value="social" className="credentials-tabs-panel">
              <TenantSocialSettingsPanel
                key={tenant.tenantId}
                tenantId={tenant.tenantId}
                services={services}
              />
            </TabsContent>
            <TabsContent
              value="registration"
              className="credentials-tabs-panel"
            >
              <TenantRegistrationSettingsPanel
                key={tenant.tenantId}
                tenantId={tenant.tenantId}
                services={services}
              />
            </TabsContent>
          </>
        ) : null}
      </Tabs>
    </div>
  );
}
