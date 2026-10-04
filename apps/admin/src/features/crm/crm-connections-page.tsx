import { useRealtimeRefresh } from "@/realtime/use-realtime-refresh";
import { useCurrentTenant } from "@/features/tenants/use-current-tenant";
import { useEffect, useMemo, useRef, useState, type ElementType } from "react";
import Nango from "@nangohq/frontend";
import Hubspot from "@thesvg/react/hubspot";
import Pipedrive from "@thesvg/react/pipedrive";
import Salesforce from "@thesvg/react/salesforce";
import Zoho from "@thesvg/react/zoho";
import { CircleAlert } from "lucide-react";
import type { AppServices } from "@/app-services";
import type {
  CrmConnection,
  CrmProvider,
  CrmProviderId,
} from "@/api/crm-client";
import { Button } from "@/components/ui/button";
import {
  IntegrationGroup,
  IntegrationGroupEmpty,
  IntegrationProviderIcon,
  IntegrationProviderRow,
  IntegrationsPageHeader,
  IntegrationsPageShell,
  type IntegrationStatusTone,
} from "@/features/personal-integrations/integration-ui";
import { Skeleton } from "@/components/ui/skeleton";

type NangoConnectEvent = unknown;

export type NangoConnectFactory = () => {
  openConnectUI(options: {
    sessionToken: string;
    baseURL: string;
    apiURL: string;
    onEvent(event: NangoConnectEvent): void | Promise<void>;
  }): unknown;
};

const browserNangoFactory: NangoConnectFactory = () => new Nango();

function connectionIdFromEvent(event: unknown): string | undefined {
  if (!event || typeof event !== "object") return undefined;
  const candidate = event as {
    connectionId?: unknown;
    payload?: { connectionId?: unknown };
  };
  if (typeof candidate.connectionId === "string") return candidate.connectionId;
  return typeof candidate.payload?.connectionId === "string"
    ? candidate.payload.connectionId
    : undefined;
}

function eventType(event: unknown): string | undefined {
  return event &&
    typeof event === "object" &&
    typeof (event as { type?: unknown }).type === "string"
    ? (event as { type: string }).type
    : undefined;
}

function providerIcon(provider: CrmProviderId) {
  return {
    hubspot: Hubspot,
    salesforce: Salesforce,
    zoho: Zoho,
    pipedrive: Pipedrive,
  }[provider];
}

function connectionStatusLabel(connection: CrmConnection): string {
  return {
    pending: "Pendiente",
    connected: "Conectado",
    reconnect_required: "Requiere reconexión",
    disconnected: "Desconectado",
    failed: "No se pudo conectar",
  }[connection.status];
}

function connectionStatusTone(
  connection: CrmConnection,
): IntegrationStatusTone {
  if (connection.status === "connected") return "success";
  if (
    connection.status === "reconnect_required" ||
    connection.status === "failed"
  )
    return "warning";
  return "neutral";
}

function providerHint(
  provider: CrmProvider,
  connection: CrmConnection | undefined,
): string {
  if (provider.connectionBlocked)
    return "Desconecta el CRM actual de la organización antes de conectar otro.";
  if (connection?.externalAccountLabel) return connection.externalAccountLabel;
  if (provider.availability === "coming_soon") return "Disponible próximamente";
  if (provider.availability !== "enabled") return "Configuración pendiente";
  return "Aún no has conectado una cuenta";
}

function feedbackFrom(exception: unknown): string {
  return exception instanceof Error
    ? exception.message
    : "No fue posible completar la operación de CRM.";
}

function actionLabel(
  provider: CrmProvider,
  connection: CrmConnection | undefined,
): string {
  if (provider.availability !== "enabled") return "No disponible";
  if (connection?.status === "connected") return "Desconectar";
  if (
    connection?.status === "reconnect_required" ||
    connection?.status === "failed"
  )
    return "Reconectar";
  return "Conectar";
}

function CrmIntegrationRows({
  providers,
  connectionsByProvider,
  actionProvider,
  onAction,
  onDisconnect,
  onReconnect,
}: {
  onReconnect: (provider: CrmProvider, connection: CrmConnection) => void;
  onDisconnect: (provider: CrmProvider) => void;
  providers: CrmProvider[];
  connectionsByProvider: Map<CrmProviderId, CrmConnection>;
  actionProvider?: CrmProviderId;
  onAction: (
    provider: CrmProvider,
    connection: CrmConnection | undefined,
  ) => void;
}) {
  return providers.map((provider) => {
    const Icon = providerIcon(provider.id) as ElementType;
    const connection = connectionsByProvider.get(provider.id);
    const enabled = provider.availability === "enabled";
    const blocked = provider.connectionBlocked === true;
    const busy = actionProvider !== undefined;
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
        statusLabel={connection ? connectionStatusLabel(connection) : undefined}
        statusTone={connection ? connectionStatusTone(connection) : "neutral"}
        showStatus={showStatus}
        actionLabel={actionLabel(provider, connection)}
        actionVariant={connected ? "outline" : "default"}
        busy={busy}
        disabled={!enabled || blocked}
        muted={!enabled || blocked}
        onAction={() => onAction(provider, connection)}
        secondaryAction={
          connected && connection ? (
            <Button
              size="sm"
              variant="outline"
              disabled={busy || !enabled || blocked}
              onClick={() => onReconnect(provider, connection)}
            >
              Reconectar
            </Button>
          ) : connection &&
            (connection.status === "pending" ||
              connection.status === "reconnect_required" ||
              connection.status === "failed") ? (
            <Button
              size="sm"
              variant="outline"
              disabled={busy || !enabled || blocked}
              onClick={() => onDisconnect(provider)}
            >
              Desconectar
            </Button>
          ) : undefined
        }
        icon={
          <IntegrationProviderIcon
            Icon={Icon}
            displayName={provider.displayName}
          />
        }
      />
    );
  });
}

export function CrmConnectionsPage({
  services,
  nangoFactory = browserNangoFactory,
  embedded = false,
}: {
  services: Pick<AppServices, "crm">;
  nangoFactory?: NangoConnectFactory;
  embedded?: boolean;
}) {
  const currentTenant = useCurrentTenant();
  const [providers, setProviders] = useState<CrmProvider[]>([]);
  const [connections, setConnections] = useState<CrmConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionProvider, setActionProvider] = useState<CrmProviderId>();
  const [feedback, setFeedback] = useState<string | null>(null);
  const [loadedTenantId, setLoadedTenantId] = useState<number | null>();
  const refreshRequestId = useRef(0);
  const latestTenant = useRef(currentTenant);
  latestTenant.current = currentTenant;

  async function refresh() {
    if (latestTenant.current.id !== currentTenant.id) return;
    if (currentTenant.isLoading || latestTenant.current.isLoading) {
      setLoading(true);
      setProviders([]);
      setConnections([]);
      setLoadedTenantId(undefined);
      return;
    }

    const requestId = ++refreshRequestId.current;
    const requestTenantId = currentTenant.id;
    setLoading(true);
    setFeedback(null);
    try {
      const [nextProviders, nextConnections] = await Promise.all([
        services.crm.listProviders(requestTenantId ?? undefined),
        services.crm.listConnections(requestTenantId ?? undefined),
      ]);
      if (
        requestId !== refreshRequestId.current ||
        requestTenantId !== latestTenant.current.id
      )
        return;
      setProviders(nextProviders ?? []);
      setConnections(nextConnections ?? []);
      setLoadedTenantId(requestTenantId);
    } catch (exception) {
      if (
        requestId !== refreshRequestId.current ||
        requestTenantId !== latestTenant.current.id
      )
        return;
      setFeedback(feedbackFrom(exception));
      setProviders([]);
      setConnections([]);
      setLoadedTenantId(requestTenantId);
    } finally {
      if (
        requestId === refreshRequestId.current &&
        requestTenantId === latestTenant.current.id
      )
        setLoading(false);
    }
  }

  useEffect(() => {
    if (currentTenant.isLoading) {
      refreshRequestId.current += 1;
      setLoading(true);
      setProviders([]);
      setConnections([]);
      setLoadedTenantId(undefined);
      return;
    }
    void refresh();
    return () => {
      refreshRequestId.current += 1;
    };
  }, [services, currentTenant.id, currentTenant.isLoading]);

  useRealtimeRefresh({
    topics: ["integrations"],
    tenantId: currentTenant.isPlatformAdmin
      ? 0
      : (currentTenant.id ?? undefined),
    enabled: !currentTenant.isLoading,
    refresh,
  });

  const tenantDataIsCurrent =
    !currentTenant.isLoading && loadedTenantId === currentTenant.id;
  const providersForCurrentTenant = tenantDataIsCurrent ? providers : [];
  const connectionsForCurrentTenant = tenantDataIsCurrent ? connections : [];

  const connectionsByProvider = useMemo(
    () =>
      new Map(
        connectionsForCurrentTenant.map((connection) => [
          connection.provider,
          connection,
        ]),
      ),
    [connectionsForCurrentTenant],
  );

  async function completeConnection(
    provider: CrmProviderId,
    connectionId: string,
  ) {
    const requestTenantId = currentTenant.id;
    try {
      await services.crm.complete(
        provider,
        connectionId,
        requestTenantId ?? undefined,
      );
      if (latestTenant.current.id === requestTenantId)
        setFeedback("La conexión CRM quedó validada.");
      await refresh();
    } catch (exception) {
      if (latestTenant.current.id === requestTenantId)
        setFeedback(feedbackFrom(exception));
    } finally {
      setActionProvider(undefined);
    }
  }

  async function beginConnection(
    provider: CrmProvider,
    connection: CrmConnection | undefined,
    reconnect = false,
  ) {
    if (
      provider.availability !== "enabled" ||
      provider.connectionBlocked === true ||
      actionProvider !== undefined
    )
      return;

    if (connection?.status === "connected" && !reconnect) {
      setActionProvider(provider.id);
      try {
        await services.crm.disconnect(
          provider.id,
          currentTenant.id ?? undefined,
        );
        setFeedback("La conexión CRM se desconectó.");
        await refresh();
      } catch (exception) {
        setFeedback(feedbackFrom(exception));
      } finally {
        setActionProvider(undefined);
      }
      return;
    }

    setActionProvider(provider.id);
    setFeedback(null);
    try {
      const session = await services.crm.createConnectSession(
        provider.id,
        reconnect ||
          connection?.status === "reconnect_required" ||
          connection?.status === "failed",
        currentTenant.id ?? undefined,
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
              setActionProvider(undefined);
              setFeedback("Nango no informó una conexión válida.");
              return;
            }
            void completeConnection(provider.id, connectionId);
            return;
          }
          if (type === "close") {
            if (terminalEventReceived) return;
            setActionProvider(undefined);
            setFeedback("La ventana de conexión se cerró sin cambios.");
            return;
          }
          if (type === "error") {
            terminalEventReceived = true;
            setActionProvider(undefined);
            setFeedback("No fue posible completar la autorización del CRM.");
          }
        },
      });
    } catch (exception) {
      setActionProvider(undefined);
      setFeedback(feedbackFrom(exception));
    }
  }

  async function disconnectConnection(provider: CrmProvider) {
    if (
      provider.availability !== "enabled" ||
      provider.connectionBlocked === true ||
      actionProvider !== undefined
    )
      return;
    setActionProvider(provider.id);
    try {
      await services.crm.disconnect(provider.id, currentTenant.id ?? undefined);
      setFeedback("La conexión CRM se desconectó.");
      await refresh();
    } catch (exception) {
      setFeedback(feedbackFrom(exception));
    } finally {
      setActionProvider(undefined);
    }
  }

  const rows = (
    <CrmIntegrationRows
      providers={providersForCurrentTenant}
      connectionsByProvider={connectionsByProvider}
      actionProvider={actionProvider}
      onReconnect={(provider, connection) =>
        void beginConnection(provider, connection, true)
      }
      onDisconnect={(provider) => void disconnectConnection(provider)}
      onAction={(provider, connection) =>
        void beginConnection(provider, connection)
      }
    />
  );

  if (embedded) {
    return (
      <>
        {tenantDataIsCurrent && feedback ? (
          <div
            className="integrations-feedback flex items-start gap-3 rounded-xl border bg-card px-4 py-3 text-sm"
            role="status"
          >
            <CircleAlert className="mt-0.5 size-4 shrink-0 text-primary" />
            <p className="leading-6">{feedback}</p>
          </div>
        ) : null}
        {loading || !tenantDataIsCurrent ? (
          <IntegrationGroup title="CRM" headingId="crm-integrations-heading">
            {Array.from({ length: 4 }, (_, index) => (
              <li key={index} className="px-5 py-4">
                <Skeleton className="h-10 w-full" />
              </li>
            ))}
          </IntegrationGroup>
        ) : (
          <IntegrationGroup title="CRM" headingId="crm-integrations-heading">
            {rows}
            {providersForCurrentTenant.length === 0 ? (
              <IntegrationGroupEmpty message="No hay integraciones CRM disponibles." />
            ) : null}
          </IntegrationGroup>
        )}
      </>
    );
  }

  return (
    <IntegrationsPageShell>
      <IntegrationsPageHeader title="Conexiones CRM" />

      {tenantDataIsCurrent && feedback ? (
        <div
          className="integrations-feedback flex items-start gap-3 rounded-xl border bg-card px-4 py-3 text-sm"
          role="status"
        >
          <CircleAlert className="mt-0.5 size-4 shrink-0 text-primary" />
          <p className="leading-6">{feedback}</p>
        </div>
      ) : null}

      {loading || !tenantDataIsCurrent ? (
        <IntegrationGroup title="CRM">
          {Array.from({ length: 4 }, (_, index) => (
            <li key={index} className="px-5 py-4">
              <Skeleton className="h-10 w-full" />
            </li>
          ))}
        </IntegrationGroup>
      ) : (
        <IntegrationGroup title="CRM">
          {rows}
          {providersForCurrentTenant.length === 0 ? (
            <IntegrationGroupEmpty message="No hay integraciones CRM disponibles." />
          ) : null}
        </IntegrationGroup>
      )}
    </IntegrationsPageShell>
  );
}
