import { useEffect, useMemo, useState, type ElementType } from "react";
import Nango from "@nangohq/frontend";
import Hubspot from "@thesvg/react/hubspot";
import Pipedrive from "@thesvg/react/pipedrive";
import Salesforce from "@thesvg/react/salesforce";
import Zoho from "@thesvg/react/zoho";
import { CircleAlert, LoaderCircle, Trash2 } from "lucide-react";
import type { AppServices } from "@/app-services";
import type {
  CrmConnection,
  CrmProvider,
  CrmProviderId,
  CrmSyncTenant,
  CrmSyncJob,
  CrmSyncRule,
} from "@/api/crm-client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  IntegrationHelpTooltip,
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
  onReconnect,
}: {
  onReconnect: (provider: CrmProvider, connection: CrmConnection) => void;
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
    const busy = actionProvider === provider.id;
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
        disabled={!enabled}
        muted={!enabled}
        onAction={() => onAction(provider, connection)}
        secondaryAction={
          connected && connection ? (
            <Button
              size="sm"
              variant="outline"
              disabled={busy || !enabled}
              onClick={() => onReconnect(provider, connection)}
            >
              Reconectar
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

type SyncClient = Pick<
  AppServices["crm"],
  | "listSyncRules"
  | "createSyncRule"
  | "setSyncRuleEnabled"
  | "deleteSyncRule"
  | "listSyncJobs"
  | "retrySyncJob"
>;

function hasSyncClient(
  crm: AppServices["crm"],
): crm is AppServices["crm"] & SyncClient {
  return [
    "listSyncRules",
    "createSyncRule",
    "setSyncRuleEnabled",
    "deleteSyncRule",
    "listSyncJobs",
    "retrySyncJob",
  ].every(
    (method) =>
      typeof (crm as unknown as Record<string, unknown>)[method] === "function",
  );
}

const syncStatusLabels: Record<CrmSyncJob["status"], string> = {
  pending: "Pendiente",
  processing: "Procesando",
  synced: "Sincronizado",
  failed: "Falló",
  blocked: "Bloqueado",
};

const syncErrorLabels: Record<string, string> = {
  CRM_CONNECTION_NOT_READY: "HubSpot requiere conexión",
  CRM_RECONNECT_REQUIRED: "HubSpot requiere reconexión",
  CRM_UNAVAILABLE: "HubSpot no está disponible",
  CONNECTION_CHANGED: "La cuenta de HubSpot cambió",
  AUTHORIZATION_REVOKED: "Se revocó la autorización",
  SOURCE_CHANGED: "El cliente cambió de tenant",
  SOURCE_DELETED: "El cliente fue eliminado",
  RULE_PAUSED: "La regla estaba pausada; espera un cambio nuevo",
  REMOTE_OUTCOME_UNKNOWN: "El resultado remoto requiere revisión",
  SYNC_FAILED: "No se pudo sincronizar",
  UPSTREAM_FAILURE: "HubSpot rechazó la operación",
};

function syncFeedback(exception: unknown): string {
  return exception instanceof Error
    ? exception.message
    : "No fue posible actualizar la sincronización.";
}

function trustedHubSpotUrl(value: string | null): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "app.hubspot.com"
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

function SyncPanel({ crm }: { crm: SyncClient }) {
  const [rules, setRules] = useState<CrmSyncRule[]>([]);
  const [tenants, setTenants] = useState<CrmSyncTenant[]>([]);
  const [jobs, setJobs] = useState<CrmSyncJob[]>([]);
  const [tenantId, setTenantId] = useState("");
  const [busy, setBusy] = useState(false);
  const [deletingRule, setDeletingRule] = useState<CrmSyncRule | null>(null);
  const [loadingSync, setLoadingSync] = useState(true);
  const [syncMessage, setSyncMessage] = useState<string>();
  const [syncError, setSyncError] = useState<string>();

  async function refresh() {
    setLoadingSync(true);
    try {
      const [configuration, latestJobs] = await Promise.all([
        crm.listSyncRules(),
        crm.listSyncJobs(),
      ]);
      setRules(configuration.rules);
      setTenants(configuration.tenants);
      setJobs(latestJobs);
      setSyncError(undefined);
    } catch (exception) {
      setSyncError(syncFeedback(exception));
    } finally {
      setLoadingSync(false);
    }
  }

  async function refreshJobs() {
    if (document.hidden) return;
    try {
      setJobs(await crm.listSyncJobs());
      setSyncError(undefined);
    } catch (exception) {
      setSyncError(syncFeedback(exception));
    }
  }

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refreshJobs(), 10_000);
    const resume = () => {
      if (!document.hidden) void refreshJobs();
    };
    document.addEventListener("visibilitychange", resume);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [crm]);

  async function enable() {
    if (!tenantId) return;
    setBusy(true);
    setSyncError(undefined);
    try {
      await crm.createSyncRule(Number(tenantId));
      await refresh();
      setSyncMessage("Sincronización activada.");
    } catch (exception) {
      setSyncError(syncFeedback(exception));
    } finally {
      setBusy(false);
    }
  }

  async function toggle(rule: CrmSyncRule) {
    setBusy(true);
    setSyncError(undefined);
    try {
      await crm.setSyncRuleEnabled(rule.id, !rule.enabled);
      await refresh();
      setSyncMessage(
        rule.enabled ? "Sincronización pausada." : "Sincronización reanudada.",
      );
    } catch (exception) {
      setSyncError(syncFeedback(exception));
    } finally {
      setBusy(false);
    }
  }

  async function confirmDeleteRule() {
    if (!deletingRule) return;
    setBusy(true);
    setSyncError(undefined);
    try {
      await crm.deleteSyncRule(deletingRule.id);
      await refresh();
      setSyncMessage("Sincronización eliminada.");
      setDeletingRule(null);
    } catch (exception) {
      setSyncError(syncFeedback(exception));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="rounded-xl border bg-card p-5"
      aria-labelledby="crm-sync-heading"
    >
      <div className="flex items-center gap-1.5">
        <h2 id="crm-sync-heading" className="text-sm font-semibold">
          Sincronización automática
        </h2>
        <IntegrationHelpTooltip label="Ayuda sobre sincronización automática">
          Envía a HubSpot clientes nuevos y actualizados después de activar un
          tenant. No importa datos históricos. No elimina registros.
        </IntegrationHelpTooltip>
      </div>
      {syncError ? (
        <p className="mt-3 text-xs text-destructive" role="alert">
          {syncError}
        </p>
      ) : syncMessage ? (
        <p className="mt-3 text-xs text-muted-foreground" role="status">
          {syncMessage}
        </p>
      ) : null}
      {loadingSync ? (
        <p className="mt-3 text-xs text-muted-foreground" role="status">
          Cargando sincronización…
        </p>
      ) : null}
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-xs font-medium">
          Tenant
          <select
            className="h-9 min-w-48 rounded-md border bg-background px-3 text-sm"
            value={tenantId}
            onChange={(event) => setTenantId(event.target.value)}
          >
            <option value="">Selecciona un tenant</option>
            {tenants.map((tenant) => (
              <option key={tenant.id} value={tenant.id}>
                {tenant.name}
              </option>
            ))}
          </select>
        </label>
        <Button
          size="sm"
          disabled={!tenantId || busy}
          onClick={() => void enable()}
        >
          Activar sincronización
        </Button>
      </div>
      {rules.length > 0 ? (
        <div className="mt-4 grid gap-2">
          {rules.map((rule) => (
            <div
              key={rule.id}
              className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm"
            >
              <div>
                <p className="font-medium">{rule.tenantName}</p>
                <p className="text-xs text-muted-foreground">
                  {rule.accountLabel} · {rule.enabled ? "Activada" : "Pausada"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void toggle(rule)}
                >
                  {rule.enabled ? "Pausar" : "Reanudar"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 w-8 p-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:ring-destructive"
                  disabled={busy}
                  onClick={() => setDeletingRule(rule)}
                  aria-label={`Eliminar sincronización de ${rule.tenantName}`}
                  title="Eliminar sincronización"
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <Dialog
        open={deletingRule !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setDeletingRule(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Eliminar sincronización</DialogTitle>
            <DialogDescription>
              {deletingRule
                ? `¿Estás seguro de que deseas eliminar la sincronización automática para ${deletingRule.tenantName}? Se cancelarán los envíos futuros a HubSpot para este tenant.`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeletingRule(null)}
              disabled={busy}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void confirmDeleteRule()}
              disabled={busy}
            >
              {busy ? (
                <LoaderCircle className="mr-2 size-4 animate-spin" />
              ) : null}
              Eliminar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {jobs.length > 0 ? (
        <details className="mt-4">
          <summary className="cursor-pointer text-xs font-medium">
            Estado reciente ({jobs.length})
          </summary>
          <ul className="mt-2 grid gap-2">
            {jobs.map((job) => (
              <li
                key={job.id}
                className="flex items-center justify-between gap-3 text-xs"
              >
                <span>
                  Cliente {job.customerId}: {syncStatusLabels[job.status]}
                  {job.lastError
                    ? ` — ${syncErrorLabels[job.lastError] ?? job.lastError}`
                    : ""}
                </span>
                {trustedHubSpotUrl(job.externalUrl) ? (
                  <a
                    className="text-primary underline-offset-4 hover:underline"
                    href={trustedHubSpotUrl(job.externalUrl)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Ver en HubSpot
                  </a>
                ) : null}
                {job.status === "failed" ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => {
                      setBusy(true);
                      setSyncError(undefined);
                      void crm
                        .retrySyncJob(job.id)
                        .then(async () => {
                          await refresh();
                          setSyncMessage("Reintento programado.");
                        })
                        .catch((exception) =>
                          setSyncError(syncFeedback(exception)),
                        )
                        .finally(() => setBusy(false));
                    }}
                  >
                    Reintentar
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
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
  const [providers, setProviders] = useState<CrmProvider[]>([]);
  const [connections, setConnections] = useState<CrmConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionProvider, setActionProvider] = useState<CrmProviderId>();
  const [feedback, setFeedback] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setFeedback(null);
    try {
      const [nextProviders, nextConnections] = await Promise.all([
        services.crm.listProviders(),
        services.crm.listConnections(),
      ]);
      setProviders(nextProviders ?? []);
      setConnections(nextConnections ?? []);
    } catch (exception) {
      setFeedback(feedbackFrom(exception));
      setProviders([]);
      setConnections([]);
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

  async function completeConnection(
    provider: CrmProviderId,
    connectionId: string,
  ) {
    try {
      await services.crm.complete(provider, connectionId);
      setFeedback("La conexión CRM quedó validada.");
      await refresh();
    } catch (exception) {
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
    if (provider.availability !== "enabled") return;

    if (connection?.status === "connected" && !reconnect) {
      setActionProvider(provider.id);
      try {
        await services.crm.disconnect(provider.id);
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

  const rows = (
    <CrmIntegrationRows
      providers={providers}
      connectionsByProvider={connectionsByProvider}
      actionProvider={actionProvider}
      onReconnect={(provider, connection) =>
        void beginConnection(provider, connection, true)
      }
      onAction={(provider, connection) =>
        void beginConnection(provider, connection)
      }
    />
  );

  if (embedded) {
    return (
      <>
        {feedback ? (
          <div
            className="integrations-feedback flex items-start gap-3 rounded-xl border bg-card px-4 py-3 text-sm"
            role="status"
          >
            <CircleAlert className="mt-0.5 size-4 shrink-0 text-primary" />
            <p className="leading-6">{feedback}</p>
          </div>
        ) : null}
        {hasSyncClient(services.crm) ? <SyncPanel crm={services.crm} /> : null}
        {loading ? (
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
            {providers.length === 0 ? (
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

      {feedback ? (
        <div
          className="integrations-feedback flex items-start gap-3 rounded-xl border bg-card px-4 py-3 text-sm"
          role="status"
        >
          <CircleAlert className="mt-0.5 size-4 shrink-0 text-primary" />
          <p className="leading-6">{feedback}</p>
        </div>
      ) : null}

      {hasSyncClient(services.crm) ? <SyncPanel crm={services.crm} /> : null}

      {loading ? (
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
          {providers.length === 0 ? (
            <IntegrationGroupEmpty message="No hay integraciones CRM disponibles." />
          ) : null}
        </IntegrationGroup>
      )}
    </IntegrationsPageShell>
  );
}
