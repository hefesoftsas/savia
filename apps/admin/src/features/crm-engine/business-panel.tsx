import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { api, downloadCrm } from "./api";
import { getCrmRuntime } from "./runtime";
import type { CrmRecord } from "@savia/crm-shared/metadata";

function apiDocsUrl() {
  const scope = getCrmRuntime().apiBasePath;
  const path = scope ? `${scope}/api/docs` : "/api/docs";
  return new URL(path, window.location.origin).toString();
}

function useBusinessApi() {
  return useMemo(() => {
    const runtime = getCrmRuntime();
    const transport = runtime.transport;
    const scopedApi: typeof api = transport
      ? async (url, method = "GET", data, options) => {
          const response = await transport("/api" + url, {
            ...options,
            method,
            headers: {
              "Content-Type": "application/json",
              ...options?.headers,
            },
            ...(data !== undefined ? { body: JSON.stringify(data) } : {}),
          });
          const result = (await response.json()) as { error?: string };
          if (!response.ok)
            throw new Error(result.error ?? `Error ${response.status}`);
          return result as never;
        }
      : api;
    return { api: scopedApi, scope: runtime.apiBasePath, transport };
  }, []);
}
export function BusinessPanel(props: {
  className?: string;
  onInstalled: () => unknown;
}) {
  return (
    <ScopedBusinessPanel
      key={getCrmRuntime().apiBasePath ?? "standalone"}
      {...props}
    />
  );
}
function ScopedBusinessPanel({
  className,
  onInstalled,
}: {
  className?: string;
  onInstalled: () => unknown;
}) {
  const { api, scope } = useBusinessApi();
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const businessEnabled = getCrmRuntime().businessSetupEnabled !== false;
  const setup = useQuery({
    enabled: businessEnabled,
    queryKey: ["business-setup", scope],
    queryFn: () => api<{ data: { installed: boolean } }>("/business/setup"),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  async function run(action: () => Promise<unknown>) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <details className={className ?? "mb-4 rounded-md border p-3"}>
      <summary className="cursor-pointer text-sm font-medium">
        {businessEnabled ? "Clientes, cotizaciones y API" : "API del dominio"}
      </summary>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {!businessEnabled ? null : setup.isPending ? (
          <p role="status">Consultando configuración…</p>
        ) : setup.data?.data.installed ? (
          <p className="text-sm text-muted-foreground">
            Clientes y Cotizaciones disponibles.
          </p>
        ) : (
          <Button
            size="sm"
            variant="outline"
            disabled={busy || !!setup.error}
            onClick={() =>
              run(async () => {
                await api("/business/setup", "POST");
                await setup.refetch();
                if (active.current) await onInstalled();
              })
            }
          >
            Instalar Clientes y Cotizaciones
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => {
            window.open(apiDocsUrl(), "_blank", "noopener,noreferrer");
          }}
        >
          Consultar API
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() =>
            run(() => downloadCrm("/api/openapi.json", "crm-openapi.json"))
          }
        >
          Descargar OpenAPI
        </Button>
      </div>
      {businessEnabled && !setup.data?.data.installed && (
        <p className="mt-2 text-sm text-muted-foreground">
          Agrega los objetos y su relación. Después podrás crear tus propios
          registros.
        </p>
      )}
      {busy && (
        <p role="status" className="mt-2 text-sm">
          Procesando…
        </p>
      )}
      {(error || setup.error) && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error || setup.error?.message}{" "}
          {setup.error && (
            <Button size="sm" variant="ghost" onClick={() => setup.refetch()}>
              Reintentar
            </Button>
          )}
        </p>
      )}
    </details>
  );
}

type LinkState = { status: string; externalObjectId?: string; url?: string };
const statuses: Record<string, string> = {
  not_synced: "Sin sincronizar",
  synced: "Sincronizado",
  syncing: "Sincronización en curso",
  uncertain: "Resultado pendiente de revisión",
  connection_required: "Conecta HubSpot desde Integraciones",
};
export function CustomerActions(props: {
  objectName: string;
  recordId: string;
  onQuotation: (record: CrmRecord) => void;
  onRefresh: () => void;
}) {
  return (
    <ScopedCustomerActions
      key={`${getCrmRuntime().apiBasePath}:${props.objectName}:${props.recordId}`}
      {...props}
    />
  );
}
function ScopedCustomerActions({
  objectName,
  recordId,
  onQuotation,
  onRefresh,
}: {
  objectName: string;
  recordId: string;
  onQuotation: (record: CrmRecord) => void;
  onRefresh: () => void;
}) {
  const { api, scope } = useBusinessApi();
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const base = `/business/${encodeURIComponent(objectName)}/${encodeURIComponent(recordId)}`;
  const link = useQuery({
    queryKey: ["business-link", scope, objectName, recordId],
    queryFn: () => api<{ data: LinkState }>(`${base}/hubspot`),
  });
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const quotationKey = useRef(crypto.randomUUID());
  const pending = useRef(false);
  async function act(kind: string) {
    if (pending.current) return;
    pending.current = true;
    setBusy(kind);
    setError("");
    try {
      if (kind === "sync") {
        await api(`${base}/hubspot`, "POST");
        await link.refetch();
        if (active.current) onRefresh();
      } else {
        const response = await api<{ data: CrmRecord }>(
          `${base}/quotations`,
          "POST",
          {},
          { headers: { "Idempotency-Key": quotationKey.current } },
        );
        quotationKey.current = crypto.randomUUID();
        if (active.current) onRefresh();
        if (active.current) onQuotation(response.data);
      }
    } catch (e) {
      setError((e as Error).message);
      if (kind === "sync") void link.refetch();
    } finally {
      pending.current = false;
      setBusy("");
    }
  }
  return (
    <section aria-label="Acciones comerciales" className="mb-4 border-b pb-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={!!busy} onClick={() => act("quote")}>
          {busy === "quote" ? "Creando cotización…" : "Crear cotización"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={
            !!busy ||
            link.isPending ||
            !!link.error ||
            ["syncing", "uncertain"].includes(link.data?.data.status ?? "")
          }
          onClick={() => act("sync")}
        >
          {busy === "sync" ? "Sincronizando…" : "Sincronizar con HubSpot"}
        </Button>
        <span className="text-sm text-muted-foreground" role="status">
          HubSpot ·{" "}
          {link.isPending
            ? "Consultando…"
            : (statuses[link.data?.data.status ?? ""] ??
              "Estado no disponible")}
          {link.data?.data.externalObjectId
            ? ` · ${link.data.data.externalObjectId}`
            : ""}
        </span>
      </div>
      {(error || link.error) && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error || link.error?.message}
        </p>
      )}
      {link.error && (
        <Button size="sm" variant="ghost" onClick={() => link.refetch()}>
          Consultar estado de nuevo
        </Button>
      )}
    </section>
  );
}
