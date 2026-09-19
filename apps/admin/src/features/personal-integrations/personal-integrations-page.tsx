import { useSearchParams } from "react-router-dom";
import { useEffect, useMemo, useState, type ElementType } from "react";
import Nango from "@nangohq/frontend";
import GoogleCalendar from "@thesvg/react/google-calendar";
import GoogleDrive from "@thesvg/react/google-drive";
import Gmail from "@thesvg/react/gmail";
import MicrosoftOnedrive from "@thesvg/react/microsoft-onedrive";
import MicrosoftOutlook from "@thesvg/react/microsoft-outlook";
import { CircleAlert } from "lucide-react";
import type { AppServices } from "@/app-services";
import type {
  PersonalIntegrationConnection,
  PersonalIntegrationProvider,
  PersonalIntegrationProviderId,
} from "@/api/personal-integrations-client";
import { CrmConnectionsPage } from "@/features/crm/crm-connections-page";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { VirtualEmployeesManagement } from "./virtual-employees-management";
import {
  IntegrationGroup,
  IntegrationGroupEmpty,
  IntegrationGroupsSkeleton,
  IntegrationProviderIcon,
  IntegrationProviderRow,
  IntegrationsPageHeader,
  IntegrationsPageShell,
  type IntegrationStatusTone,
} from "./integration-ui";

type NangoConnectEvent = unknown;

export type PersonalNangoConnectFactory = () => {
  openConnectUI(options: {
    sessionToken: string;
    baseURL: string;
    apiURL: string;
    onEvent(event: NangoConnectEvent): void | Promise<void>;
  }): unknown;
};

const browserNangoFactory: PersonalNangoConnectFactory = () => new Nango();

const unavailableProviders: PersonalIntegrationProvider[] = [
  {
    id: "google_drive",
    displayName: "Google Drive",
    availability: "unavailable",
    capabilities: [],
  },
  {
    id: "gmail",
    displayName: "Gmail",
    availability: "unavailable",
    capabilities: [],
  },
  {
    id: "google_calendar",
    displayName: "Google Calendar",
    availability: "unavailable",
    capabilities: [],
  },
  {
    id: "outlook",
    displayName: "Outlook",
    availability: "unavailable",
    capabilities: [],
  },
  {
    id: "onedrive_personal",
    displayName: "OneDrive Personal",
    availability: "unavailable",
    capabilities: [],
  },
  {
    id: "onedrive_business",
    displayName: "OneDrive for Business",
    availability: "unavailable",
    capabilities: [],
  },
];

const providerLoadFailure = "No pudimos cargar el estado de las integraciones.";
const outdatedApiFailure =
  "La API que está en ejecución aún no incluye las integraciones personales. Reinicia Savia desde la versión actual.";

function eventType(event: unknown): string | undefined {
  return event &&
    typeof event === "object" &&
    typeof (event as { type?: unknown }).type === "string"
    ? (event as { type: string }).type
    : undefined;
}

function connectionIdFromEvent(event: unknown): string | undefined {
  if (!event || typeof event !== "object") return undefined;
  const candidate = event as {
    connectionId?: unknown;
    payload?: { connectionId?: unknown };
  };
  return typeof candidate.connectionId === "string"
    ? candidate.connectionId
    : typeof candidate.payload?.connectionId === "string"
      ? (candidate.payload.connectionId as string)
      : undefined;
}

function providerIcon(provider: PersonalIntegrationProviderId) {
  return {
    google_drive: GoogleDrive,
    gmail: Gmail,
    google_calendar: GoogleCalendar,
    outlook: MicrosoftOutlook,
    onedrive_personal: MicrosoftOnedrive,
    onedrive_business: MicrosoftOnedrive,
  }[provider];
}

function providerHint(
  provider: PersonalIntegrationProvider,
  connection: PersonalIntegrationConnection | undefined,
): string {
  if (provider.availability === "unavailable")
    return "El servicio está temporalmente no disponible.";
  if (connection?.status === "connected")
    return connection.externalAccountLabel
      ? `Conectado como ${connection.externalAccountLabel}.`
      : "Conexión autorizada y lista para usarse.";
  if (connection?.status === "reconnect_required")
    return "La sesión expiró. Vuelve a conectar para continuar usándola.";
  if (connection?.status === "failed")
    return "La última sincronización falló. Intenta reconectar la cuenta.";
  if (connection?.status === "pending")
    return "Finalizando la autorización en segundo plano…";
  return "Requiere tu autorización antes de que Savia pueda interactuar con ella.";
}

function connectionStatusLabel(
  connection: PersonalIntegrationConnection,
): string {
  switch (connection.status) {
    case "connected":
      return "Conectada";
    case "reconnect_required":
      return "Reconectar";
    case "failed":
      return "Falló";
    case "pending":
      return "Pendiente";
    case "disconnected":
    default:
      return "Desconectada";
  }
}

function connectionStatusTone(
  connection: PersonalIntegrationConnection,
): IntegrationStatusTone {
  switch (connection.status) {
    case "connected":
      return "success";
    case "reconnect_required":
    case "failed":
      return "warning";
    case "pending":
    case "disconnected":
    default:
      return "neutral";
  }
}

function actionLabel(
  provider: PersonalIntegrationProvider,
  connection: PersonalIntegrationConnection | undefined,
): string {
  if (provider.availability !== "enabled") return "No disponible";
  if (connection?.status === "connected") return "Desconectar";
  if (
    connection?.status === "reconnect_required" ||
    connection?.status === "failed"
  )
    return "Reconectar";
  if (connection?.status === "pending") return "Reintentar";
  return "Conectar";
}

function feedbackFrom(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message?: unknown }).message);
  }
  return "Ocurrió un error inesperado al gestionar la integración.";
}

function providerLoadFeedback(error: unknown): string {
  return error &&
    typeof error === "object" &&
    (error as { status?: unknown }).status === 404
    ? outdatedApiFailure
    : providerLoadFailure;
}

export function PersonalIntegrationsPage({
  services,
  nangoFactory = browserNangoFactory,
}: {
  services: Pick<
    AppServices,
    | "personalIntegrations"
    | "authProvider"
    | "crm"
    | "dataProvider"
    | "virtualEmployees"
  > & {
    assistantConfiguration?: AppServices["assistantConfiguration"];
  };
  nangoFactory?: PersonalNangoConnectFactory;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab =
    searchParams.get("tab") === "virtual-employees"
      ? "virtual-employees"
      : "connections";
  const selectTab = (tab: string) => {
    const next = new URLSearchParams(searchParams);
    next.set("tab", tab);
    setSearchParams(next);
  };
  const [providers, setProviders] = useState<PersonalIntegrationProvider[]>([]);
  const [connections, setConnections] = useState<
    PersonalIntegrationConnection[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [actionProvider, setActionProvider] =
    useState<PersonalIntegrationProviderId>();
  const [feedback, setFeedback] = useState<string | null>(null);
  const [providerLoadFailed, setProviderLoadFailed] = useState(false);

  async function refresh() {
    setLoading(true);
    try {
      const [nextProviders, nextConnections] = await Promise.all([
        services.personalIntegrations.listProviders(),
        services.personalIntegrations.listConnections(),
      ]);
      setProviders(nextProviders);
      setConnections(nextConnections);
      setFeedback(null);
      setProviderLoadFailed(false);
    } catch (error) {
      setProviders(unavailableProviders);
      setConnections([]);
      setFeedback(providerLoadFeedback(error));
      setProviderLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, [services]);

  const connectionsByProvider = useMemo(
    () =>
      new Map(
        connections.map((connection) => [connection.provider, connection]),
      ),
    [connections],
  );

  async function complete(
    provider: PersonalIntegrationProviderId,
    connectionId: string,
  ) {
    try {
      await services.personalIntegrations.complete(provider, connectionId);
      setFeedback("La cuenta quedó conectada de forma segura.");
      await refresh();
    } catch (error) {
      setFeedback(feedbackFrom(error));
    } finally {
      setActionProvider(undefined);
    }
  }

  async function begin(
    provider: PersonalIntegrationProvider,
    connection: PersonalIntegrationConnection | undefined,
  ) {
    if (provider.availability !== "enabled") return;
    setActionProvider(provider.id);
    setFeedback(null);
    setProviderLoadFailed(false);
    if (connection?.status === "connected") {
      try {
        await services.personalIntegrations.disconnect(provider.id);
        setFeedback("La cuenta quedó desconectada.");
        await refresh();
      } catch (error) {
        setFeedback(feedbackFrom(error));
      } finally {
        setActionProvider(undefined);
      }
      return;
    }
    try {
      const session = await services.personalIntegrations.createConnectSession(
        provider.id,
        connection?.status === "reconnect_required" ||
          connection?.status === "failed",
      );
      let terminalEventReceived = false;
      nangoFactory().openConnectUI({
        sessionToken: session.token,
        baseURL: session.connectUrl,
        apiURL: session.apiUrl,
        onEvent: (event) => {
          const type = eventType(event);
          if (type === "connect") {
            terminalEventReceived = true;
            const connectionId = connectionIdFromEvent(event);
            if (!connectionId) {
              setFeedback("Nango no informó una conexión válida.");
              setActionProvider(undefined);
              return;
            }
            void complete(provider.id, connectionId);
          }
          if (type === "close" && !terminalEventReceived) {
            setFeedback("La ventana de conexión se cerró sin cambios.");
            setActionProvider(undefined);
          }
          if (type === "error") {
            terminalEventReceived = true;
            setFeedback(
              "No fue posible completar la autorización de la cuenta.",
            );
            setActionProvider(undefined);
          }
        },
      });
    } catch (error) {
      setFeedback(feedbackFrom(error));
      setActionProvider(undefined);
    }
  }

  const groups = [
    {
      id: "google-integrations",
      title: "Google",
      providers: providers.filter(
        (provider) =>
          provider.id.startsWith("google") || provider.id === "gmail",
      ),
    },
    {
      id: "microsoft-integrations",
      title: "Microsoft",
      providers: providers.filter(
        (provider) =>
          provider.id === "outlook" || provider.id.startsWith("onedrive"),
      ),
    },
  ];

  return (
    <IntegrationsPageShell>
      <IntegrationsPageHeader
        title="Integraciones"
        description="Conecta tus cuentas, servicios y configura los empleados virtuales de IA para Savia."
      />

      <Tabs
        value={activeTab}
        onValueChange={selectTab}
        className="w-full space-y-6"
      >
        <TabsList className="mb-2">
          <TabsTrigger value="connections">Cuentas y Conexiones</TabsTrigger>
          <TabsTrigger value="virtual-employees">
            Empleados Virtuales (IA)
          </TabsTrigger>
        </TabsList>

        <TabsContent value="connections" className="space-y-6">
          {feedback ? (
            <div
              className="integrations-feedback flex flex-wrap items-center gap-3 rounded-xl border bg-card px-4 py-3 text-sm"
              role="alert"
              aria-label={feedback}
            >
              <CircleAlert className="mt-0.5 size-4 shrink-0 text-primary" />
              <p className="flex-1 leading-6">{feedback}</p>
              {providerLoadFailed ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={loading}
                  onClick={() => void refresh()}
                >
                  Reintentar
                </Button>
              ) : null}
            </div>
          ) : null}

          {loading ? (
            <IntegrationGroupsSkeleton groups={3} />
          ) : (
            <div className="integrations-groups">
              {groups.map((group) => (
                <IntegrationGroup
                  key={group.id}
                  title={group.title}
                  headingId={group.id}
                >
                  {group.providers.map((provider) => {
                    const Icon = providerIcon(provider.id) as ElementType;
                    const connection = connectionsByProvider.get(provider.id);
                    const busy = actionProvider === provider.id;
                    const enabled = provider.availability === "enabled";
                    const connected = connection?.status === "connected";
                    const showStatus =
                      !!connection &&
                      (connected ||
                        connection.status === "reconnect_required" ||
                        connection.status === "failed" ||
                        connection.status === "pending");
                    return (
                      <IntegrationProviderRow
                        key={provider.id}
                        name={provider.displayName}
                        hint={providerHint(provider, connection)}
                        statusLabel={
                          connection
                            ? connectionStatusLabel(connection)
                            : undefined
                        }
                        statusTone={
                          connection
                            ? connectionStatusTone(connection)
                            : "neutral"
                        }
                        showStatus={showStatus}
                        actionLabel={actionLabel(provider, connection)}
                        actionVariant={connected ? "outline" : "default"}
                        busy={busy}
                        disabled={!enabled}
                        muted={!enabled}
                        onAction={() => void begin(provider, connection)}
                        icon={
                          <IntegrationProviderIcon
                            Icon={Icon}
                            displayName={provider.displayName}
                          />
                        }
                      />
                    );
                  })}
                  {group.providers.length === 0 ? (
                    <IntegrationGroupEmpty message="No hay integraciones disponibles." />
                  ) : null}
                </IntegrationGroup>
              ))}

              <CrmConnectionsPage embedded services={{ crm: services.crm }} />
            </div>
          )}
        </TabsContent>

        <TabsContent value="virtual-employees" className="space-y-6">
          <VirtualEmployeesManagement
            client={services.virtualEmployees}
            assistantConfigClient={services.assistantConfiguration}
          />
        </TabsContent>
      </Tabs>
    </IntegrationsPageShell>
  );
}
