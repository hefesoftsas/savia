import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { History, Download, Trash2 } from "lucide-react";
import { useMessages, useAppLocale, intlLocale } from "@/i18n/core";
import { automationMessages } from "@/i18n/locales/automation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { StudioHelpTooltip } from "./studio-help-tooltip";
import { api, downloadCrm } from "./api";

type AuditEvent = {
  id: string;
  action: string;
  object_name: string | null;
  record_id: string | null;
  created_at: string;
  detail: unknown;
};

export default function Audit({ objectName }: { objectName?: string }) {
  const t = useMessages(automationMessages);
  const locale = useAppLocale();
  const [target, setTarget] = useState<AuditEvent | "all" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const suffix = objectName ? `?object=${encodeURIComponent(objectName)}` : "";
  const query = useQuery({
    queryKey: ["audit", objectName],
    queryFn: () => api<{ data: AuditEvent[] }>("/audit" + suffix),
  });
  const actions: Record<string, string> = {
    "record.created": t("Registro creado"),
    "record.updated": t("Registro actualizado"),
    "record.deleted": t("Registro eliminado"),
    "object.created": t("Objeto creado"),
    "object.updated": t("Formulario publicado"),
    "object.imported": t("Objeto importado"),
    "object.deleted": t("Pantalla eliminada"),
    "solution.installed": t("Aplicación instalada"),
    "solution.enabled": t("Aplicación activada"),
    "solution.disabled": t("Aplicación desactivada"),
    "integration.executed": t("Operación ejecutada"),
  };
  const title = (row: AuditEvent) => actions[row.action] ?? row.action;
  async function run(operation: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await operation();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div className="flex items-center gap-2">
          <h1>{t("Historial de cambios")}</h1>
          <StudioHelpTooltip label={t("Información del historial")}>
            {t(
              "Abre un evento para ver sus detalles. El CSV incluye todo el historial del ámbito consultado.",
            )}
          </StudioHelpTooltip>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void query.refetch()}
          >
            {t("Actualizar")}
          </Button>
          <Button
            variant="outline"
            disabled={busy || !query.data?.data.length}
            onClick={() =>
              void run(() =>
                downloadCrm("/api/audit/export.csv" + suffix, "historial.csv"),
              )
            }
          >
            <Download aria-hidden="true" />
            {t("Exportar CSV")}
          </Button>
          <Button
            variant="outline"
            disabled={busy || !query.data?.data.length}
            onClick={() => setTarget("all")}
          >
            <Trash2 aria-hidden="true" />
            {t("Eliminar todos")}
          </Button>
        </div>
      </div>
      {(error || query.error) && (
        <p role="alert" className="text-sm text-destructive">
          {error || query.error?.message}
        </p>
      )}
      {query.isPending ? (
        <p role="status">{t("Cargando historial…")}</p>
      ) : query.data?.data.length ? (
        <div className="overflow-hidden rounded-xl border">
          {query.data.data.map((row) => (
            <details key={row.id} className="border-b last:border-b-0">
              <summary className="cursor-pointer p-4 focus-visible:outline focus-visible:outline-2">
                <span className="ml-2 inline-flex max-w-full flex-wrap items-center gap-x-4 gap-y-1 align-middle">
                  <History
                    className="size-4 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <span>
                    <strong className="block text-sm">{title(row)}</strong>
                    <span className="text-xs text-muted-foreground">
                      {row.object_name}
                    </span>
                  </span>
                  <time className="text-xs text-muted-foreground">
                    {new Date(row.created_at).toLocaleString(
                      intlLocale(locale),
                    )}
                  </time>
                </span>
              </summary>
              <div className="space-y-4 bg-muted/20 px-6 pb-5 pt-2">
                <dl className="grid gap-2 text-sm">
                  <div>
                    <dt className="font-medium">{t("ID del evento")}</dt>
                    <dd className="break-all">{row.id}</dd>
                  </div>
                  <div>
                    <dt className="font-medium">{t("Acción")}</dt>
                    <dd>{row.action}</dd>
                  </div>
                  <div>
                    <dt className="font-medium">{t("Registro")}</dt>
                    <dd className="break-all">{row.record_id ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="font-medium">{t("Fecha")}</dt>
                    <dd>{row.created_at}</dd>
                  </div>
                </dl>
                <div>
                  <h2 className="mb-2 text-sm font-medium">
                    {t("Detalles del evento")}
                  </h2>
                  <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-md border bg-background p-3 text-xs">
                    {JSON.stringify(row.detail, null, 2) ?? "—"}
                  </pre>
                </div>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => setTarget(row)}
                >
                  <Trash2 aria-hidden="true" />
                  {t("Eliminar evento")}
                </Button>
              </div>
            </details>
          ))}
        </div>
      ) : !query.error ? (
        <p className="p-6 text-sm text-muted-foreground">
          {t("No hay eventos en este historial.")}
        </p>
      ) : null}
      <Dialog
        open={target !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {target === "all"
                ? t("Eliminar todos los eventos")
                : t("Eliminar evento")}
            </DialogTitle>
            <DialogDescription>
              {target === "all"
                ? objectName
                  ? t(
                      "Se eliminará todo el historial de esta pantalla, incluidos los eventos que no aparecen en la lista.",
                    )
                  : t(
                      "Se eliminará todo el historial de este tenant, incluidos los eventos que no aparecen en la lista.",
                    )
                : t("Se eliminará este evento del historial.")}{" "}
              {t(
                "Los registros y las pantallas no se eliminarán. Esta acción no se puede deshacer.",
              )}
            </DialogDescription>
          </DialogHeader>
          {target && target !== "all" && (
            <p className="break-all text-sm">
              {title(target)} · {target.id}
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setTarget(null)}
            >
              {t("Cancelar")}
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  if (!target) return;
                  await api(
                    target === "all"
                      ? "/audit" + suffix
                      : "/audit/" + encodeURIComponent(target.id),
                    "DELETE",
                  );
                  setTarget(null);
                  await query.refetch();
                })
              }
            >
              {busy ? t("Procesando…") : t("Confirmar eliminación")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
