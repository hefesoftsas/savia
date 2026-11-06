import { useMessages } from "@/i18n/core";
import { automationMessages } from "@/i18n/locales/automation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { api, downloadCrm } from "./api";
import { getStudioRuntime } from "./runtime";

function apiDocsUrl() {
  const scope = getStudioRuntime().apiBasePath;
  const path = scope ? `${scope}/api/docs` : "/api/docs";
  return new URL(path, window.location.origin).toString();
}

function useBusinessApi() {
  return useMemo(() => {
    const runtime = getStudioRuntime();
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
      key={getStudioRuntime().apiBasePath ?? "standalone"}
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
  const t = useMessages(automationMessages);

  const { api, scope } = useBusinessApi();
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const businessEnabled = getStudioRuntime().businessSetupEnabled !== false;
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
        {businessEnabled
          ? t("Clientes, cotizaciones y API")
          : t("API del tenant")}
      </summary>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {!businessEnabled ? null : setup.isPending ? (
          <p role="status">{t("Consultando configuración…")}</p>
        ) : setup.data?.data.installed ? (
          <p className="text-sm text-muted-foreground">
            {t("Clientes y Cotizaciones disponibles.")}
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
            {t("Instalar Clientes y Cotizaciones")}
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
          {t("Consultar API")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() =>
            run(() => downloadCrm("/api/openapi.json", "crm-openapi.json"))
          }
        >
          {t("Descargar OpenAPI")}
        </Button>
      </div>
      {businessEnabled && !setup.data?.data.installed && (
        <p className="mt-2 text-sm text-muted-foreground">
          {t(
            "Agrega los objetos y su relación. Después podrás crear tus propios registros.",
          )}
        </p>
      )}
      {busy && (
        <p role="status" className="mt-2 text-sm">
          {t("Procesando…")}
        </p>
      )}
      {(error || setup.error) && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error || setup.error?.message}{" "}
          {setup.error && (
            <Button size="sm" variant="ghost" onClick={() => setup.refetch()}>
              {t("Reintentar")}
            </Button>
          )}
        </p>
      )}
    </details>
  );
}
