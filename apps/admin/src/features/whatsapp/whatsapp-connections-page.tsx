import { useRealtimeRefresh } from "@/realtime/use-realtime-refresh";
import { useCurrentTenant } from "@/features/tenants/use-current-tenant";
import { useEffect, useRef, useState } from "react";
import Nango from "@nangohq/frontend";
import Whatsapp from "@thesvg/react/whatsapp";
import { CircleAlert, RotateCcw, Send } from "lucide-react";
import type { AppServices } from "@/app-services";
import type {
  WhatsappConnection,
  WhatsappProvider,
} from "@/api/whatsapp-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { WhatsappAssistantSettings } from "./whatsapp-assistant-settings";
import { WhatsappNativeSettings } from "./whatsapp-native-settings";

type NangoConnectEvent = unknown;

export type WhatsappNangoConnectFactory = () => {
  openConnectUI(options: {
    sessionToken: string;
    baseURL: string;
    apiURL: string;
    onEvent(event: NangoConnectEvent): void | Promise<void>;
  }): unknown;
};

const browserNangoFactory: WhatsappNangoConnectFactory = () => new Nango();

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

function connectionStatusLabel(connection: WhatsappConnection): string {
  return {
    pending: "Pendiente",
    connected: "Conectado",
    reconnect_required: "Requiere reconexión",
    disconnected: "Desconectado",
    failed: "No se pudo conectar",
  }[connection.status];
}

function connectionStatusTone(
  connection: WhatsappConnection,
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
  provider: WhatsappProvider,
  connection: WhatsappConnection | undefined,
): string {
  if (connection?.displayPhoneNumber)
    return connection.externalAccountLabel
      ? `${connection.displayPhoneNumber} · ${connection.externalAccountLabel}`
      : connection.displayPhoneNumber;
  if (connection) return "Vincula el número de WhatsApp Business abajo.";
  if (provider.availability !== "enabled") return "Configuración pendiente";
  return "Conecta tu cuenta de WhatsApp Business vía Nango";
}

function feedbackFrom(exception: unknown): string {
  return exception instanceof Error
    ? exception.message
    : "No fue posible completar la operación de WhatsApp.";
}

export function WhatsappConnectionsPage({
  services,
  nangoFactory = browserNangoFactory,
  embedded = false,
}: {
  services: Pick<AppServices, "whatsapp">;
  nangoFactory?: WhatsappNangoConnectFactory;
  embedded?: boolean;
}) {
  const currentTenant = useCurrentTenant();
  const [provider, setProvider] = useState<WhatsappProvider | null>(null);
  const [connection, setConnection] = useState<WhatsappConnection | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [loadedTenantId, setLoadedTenantId] = useState<number | null>();
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [displayPhoneNumber, setDisplayPhoneNumber] = useState("");
  const [wabaId, setWabaId] = useState("");
  const [testTo, setTestTo] = useState("");
  const [testText, setTestText] = useState("");
  const refreshRequestId = useRef(0);
  const latestTenant = useRef(currentTenant);
  latestTenant.current = currentTenant;

  async function refresh() {
    if (latestTenant.current.id !== currentTenant.id) return;
    if (currentTenant.isLoading || latestTenant.current.isLoading) {
      setLoading(true);
      setProvider(null);
      setConnection(null);
      setLoadedTenantId(undefined);
      return;
    }

    const requestId = ++refreshRequestId.current;
    const requestTenantId = currentTenant.id;
    setLoading(true);
    setFeedback(null);
    try {
      const [nextProviders, nextConnections] = await Promise.all([
        services.whatsapp.listProviders(requestTenantId ?? undefined),
        services.whatsapp.listConnections(requestTenantId ?? undefined),
      ]);
      if (
        requestId !== refreshRequestId.current ||
        requestTenantId !== latestTenant.current.id
      )
        return;
      setProvider(nextProviders[0] ?? null);
      const next = nextConnections[0] ?? null;
      setConnection(next);
      setPhoneNumberId(next?.phoneNumberId ?? "");
      setDisplayPhoneNumber(next?.displayPhoneNumber ?? "");
      setWabaId(next?.wabaId ?? "");
      setLoadedTenantId(requestTenantId);
    } catch (exception) {
      if (
        requestId !== refreshRequestId.current ||
        requestTenantId !== latestTenant.current.id
      )
        return;
      setFeedback(feedbackFrom(exception));
      setProvider(null);
      setConnection(null);
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
      setProvider(null);
      setConnection(null);
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
  const enabled = provider?.availability === "enabled";
  const connected = connection?.status === "connected";

  async function completeConnection(nangoConnectionId: string) {
    const requestTenantId = currentTenant.id;
    try {
      await services.whatsapp.complete(nangoConnectionId, {
        ...(requestTenantId !== null ? { agencyId: requestTenantId } : {}),
        ...(phoneNumberId.trim()
          ? { phoneNumberId: phoneNumberId.trim() }
          : {}),
        ...(displayPhoneNumber.trim()
          ? { displayPhoneNumber: displayPhoneNumber.trim() }
          : {}),
        ...(wabaId.trim() ? { wabaId: wabaId.trim() } : {}),
      });
      if (latestTenant.current.id === requestTenantId)
        setFeedback("La conexión de WhatsApp quedó validada.");
      await refresh();
    } catch (exception) {
      if (latestTenant.current.id === requestTenantId)
        setFeedback(feedbackFrom(exception));
    } finally {
      setBusy(false);
    }
  }

  async function beginConnection(reconnect = false) {
    if (!enabled || busy) return;
    if (connected && !reconnect) {
      setBusy(true);
      try {
        await services.whatsapp.disconnect(currentTenant.id ?? undefined);
        setFeedback("La conexión de WhatsApp se desconectó.");
        await refresh();
      } catch (exception) {
        setFeedback(feedbackFrom(exception));
      } finally {
        setBusy(false);
      }
      return;
    }

    setBusy(true);
    setFeedback(null);
    try {
      const session = await services.whatsapp.createConnectSession(
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
              setBusy(false);
              setFeedback("Nango no informó una conexión válida.");
              return;
            }
            void completeConnection(connectionId);
            return;
          }
          if (type === "close") {
            if (terminalEventReceived) return;
            setBusy(false);
            setFeedback("La ventana de conexión se cerró sin cambios.");
            return;
          }
          if (type === "error") {
            terminalEventReceived = true;
            setBusy(false);
            setFeedback("No fue posible completar la autorización.");
          }
        },
      });
    } catch (exception) {
      setBusy(false);
      setFeedback(feedbackFrom(exception));
    }
  }

  async function saveNumber() {
    if (!enabled || busy || !phoneNumberId.trim()) return;
    setBusy(true);
    try {
      await services.whatsapp.updateNumber({
        ...(currentTenant.id !== null ? { agencyId: currentTenant.id } : {}),
        phoneNumberId: phoneNumberId.trim(),
        ...(displayPhoneNumber.trim()
          ? { displayPhoneNumber: displayPhoneNumber.trim() }
          : {}),
        ...(wabaId.trim() ? { wabaId: wabaId.trim() } : {}),
      });
      setFeedback("El número de WhatsApp quedó vinculado y validado.");
      await refresh();
    } catch (exception) {
      setFeedback(feedbackFrom(exception));
    } finally {
      setBusy(false);
    }
  }

  async function sendTest() {
    if (!enabled || busy || currentTenant.id === null) return;
    if (!testTo.trim() || !testText.trim()) {
      setFeedback("Indica el destino y el texto del mensaje de prueba.");
      return;
    }
    setBusy(true);
    try {
      const result = await services.whatsapp.testSend({
        agencyId: currentTenant.id,
        to: testTo.trim(),
        text: testText.trim(),
      });
      setFeedback(`Mensaje de prueba aceptado (${result.messageId}).`);
    } catch (exception) {
      setFeedback(feedbackFrom(exception));
    } finally {
      setBusy(false);
    }
  }

  const actionLabel = !enabled
    ? "No disponible"
    : connected
      ? "Desconectar"
      : connection?.status === "reconnect_required" ||
          connection?.status === "failed"
        ? "Reconectar"
        : "Conectar";

  const content = (
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

      {loading || !tenantDataIsCurrent || !provider ? (
        <IntegrationGroup title="WhatsApp">
          <li className="px-5 py-4">
            <Skeleton className="h-10 w-full" />
          </li>
        </IntegrationGroup>
      ) : (
        <IntegrationGroup title="WhatsApp">
          <IntegrationProviderRow
            name={provider.displayName}
            hint={providerHint(provider, connection ?? undefined)}
            statusLabel={
              connection ? connectionStatusLabel(connection) : undefined
            }
            statusTone={
              connection ? connectionStatusTone(connection) : "neutral"
            }
            showStatus={!!connection}
            actionLabel={actionLabel}
            actionVariant={connected ? "outline" : "default"}
            busy={busy}
            disabled={!enabled}
            muted={!enabled}
            onAction={() => void beginConnection()}
            secondaryAction={
              connected && connection ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="max-sm:size-11 max-sm:p-0 max-sm:has-[>svg]:px-0"
                  disabled={busy || !enabled}
                  onClick={() => void beginConnection(true)}
                >
                  <RotateCcw aria-hidden="true" />
                  <span className="sr-only sm:not-sr-only">Reconectar</span>
                </Button>
              ) : undefined
            }
            icon={
              <IntegrationProviderIcon Icon={Whatsapp} displayName="WhatsApp" />
            }
          />
          {provider.availability !== "enabled" ? (
            <IntegrationGroupEmpty message="Un administrador debe crear la integración whatsapp-business en Nango. Después podrás conectar tu cuenta aquí." />
          ) : null}
        </IntegrationGroup>
      )}

      {enabled && connected && tenantDataIsCurrent ? (
        <>
          <IntegrationGroup title="Número de WhatsApp">
            <li className="space-y-3 px-5 py-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="block text-sm">
                  <span className="mb-1 block font-medium">
                    Phone number ID
                  </span>
                  <Input
                    value={phoneNumberId}
                    onChange={(event) => setPhoneNumberId(event.target.value)}
                    placeholder="123456789012345"
                    inputMode="numeric"
                    disabled={busy}
                  />
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block font-medium">Número visible</span>
                  <Input
                    value={displayPhoneNumber}
                    onChange={(event) =>
                      setDisplayPhoneNumber(event.target.value)
                    }
                    placeholder="+573001234567"
                    disabled={busy}
                  />
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block font-medium">WABA ID</span>
                  <Input
                    value={wabaId}
                    onChange={(event) => setWabaId(event.target.value)}
                    placeholder="987654321098765"
                    inputMode="numeric"
                    disabled={busy}
                  />
                </label>
              </div>
              <Button
                size="sm"
                disabled={busy || !phoneNumberId.trim()}
                onClick={() => void saveNumber()}
              >
                Vincular número
              </Button>
              <p className="text-xs leading-5 text-muted-foreground">
                Savia valida el número contra la API de WhatsApp vía Nango antes
                de guardarlo. Los tokens quedan en Nango.
              </p>
            </li>
          </IntegrationGroup>

          {currentTenant.id !== null ? (
            <WhatsappAssistantSettings
              key={currentTenant.id}
              services={services}
              tenantId={currentTenant.id}
              connected={connected}
            />
          ) : null}

          {currentTenant.id !== null ? (
            <WhatsappNativeSettings
              key={`native-${currentTenant.id}`}
              services={services}
              tenantId={currentTenant.id}
            />
          ) : null}

          <IntegrationGroup title="Probar envío">
            <li className="space-y-3 px-5 py-4">
              <div className="grid gap-3 sm:grid-cols-[1fr_2fr]">
                <label className="block text-sm">
                  <span className="mb-1 block font-medium">Destino</span>
                  <Input
                    value={testTo}
                    onChange={(event) => setTestTo(event.target.value)}
                    placeholder="+573001234567"
                    disabled={busy || !connection?.phoneNumberId}
                  />
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block font-medium">Texto</span>
                  <Input
                    value={testText}
                    onChange={(event) => setTestText(event.target.value)}
                    placeholder="Hola desde Savia"
                    maxLength={1000}
                    disabled={busy || !connection?.phoneNumberId}
                  />
                </label>
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={busy || !connection?.phoneNumberId}
                onClick={() => void sendTest()}
              >
                <Send aria-hidden="true" />
                Enviar prueba
              </Button>
              {!connection?.phoneNumberId ? (
                <p className="text-xs leading-5 text-muted-foreground">
                  Vincula primero el número para habilitar el envío. El mensaje
                  solo llega dentro de la ventana de 24 horas del contacto.
                </p>
              ) : null}
            </li>
          </IntegrationGroup>
        </>
      ) : null}
    </>
  );

  if (embedded) {
    return <>{content}</>;
  }

  return (
    <IntegrationsPageShell>
      <IntegrationsPageHeader title="WhatsApp" />
      {content}
    </IntegrationsPageShell>
  );
}
