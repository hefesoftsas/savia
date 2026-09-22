import { useEffect, useState } from "react";
import {
  CheckCircle2,
  CircleAlert,
  Cloud,
  CloudOff,
  LoaderCircle,
  Lock,
  WifiOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useOnlineStatus } from "@/offline/use-online-status";
import type { LocalWorkspace } from "./workspaces";
import type { Mutation, LocalStatus } from "./contracts";

type SyncTone = "ok" | "error" | "warn" | "sync" | "neutral";

export function LocalSyncStatus({ workspace }: { workspace: LocalWorkspace }) {
  const [status, setStatus] = useState<LocalStatus>({
    pending: 0,
    conflicts: 0,
    errors: 0,
  });
  const [problems, setProblems] = useState<Mutation[]>([]);
  const [ready, setReady] = useState(false);
  const [hasLocal, setHasLocal] = useState(false);
  const [deletedConflicts, setDeletedConflicts] = useState(new Set<string>());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [readError, setReadError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const online = useOnlineStatus();
  useEffect(() => {
    let active = true;
    let revision = 0;
    setLoaded(false);
    setError("");
    setReadError("");
    const refresh = () => {
      const current = ++revision;
      void Promise.all([
        workspace.store.status(),
        workspace.store.db.outbox.toArray(),
        workspace.store.db.syncState.toArray(),
        workspace.store.db.collections.toArray(),
        workspace.store.db.conflicts.toArray(),
      ])
        .then(([next, ops, states, collections, conflicts]) => {
          if (!active || current !== revision) return;
          setLoaded(true);
          setReadError("");
          setStatus(next);
          setProblems(
            ops.filter((op) => !op.quarantined && op.state !== "pending"),
          );
          setHasLocal(collections.some((c) => c.capability !== "remote"));
          setDeletedConflicts(
            new Set(
              conflicts
                .filter((c) => c.master?.deleted_at)
                .map((c) => c.mutationId),
            ),
          );
          setReady(
            collections.length > 0 &&
              collections
                .filter((c) => c.capability !== "remote")
                .every((c) =>
                  states.some((s) => s.collection === c.name && s.hydrated),
                ),
          );
        })
        .catch(() => {
          if (active && current === revision)
            setReadError(
              "No se pudo leer el estado local. Tus cambios no se han descartado. Reintenta la sincronización.",
            );
        });
    };
    refresh();
    const unsubscribe = workspace.store.subscribe(refresh);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [workspace]);
  const act = async (action: () => Promise<unknown>, request = true) => {
    setBusy(true);
    setError("");
    try {
      await action();
      if (request) workspace.requestSync();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo sincronizar.");
    } finally {
      setBusy(false);
    }
  };
  const attention = (status.conflicts ?? 0) + (status.errors ?? 0);
  const statusLabel = readError
    ? "Estado local no disponible"
    : !loaded
      ? "Comprobando estado local…"
      : status.authorizationError
        ? "Acceso revocado · vuelve a iniciar sesión"
        : status.syncing
          ? "Sincronizando…"
          : !online
            ? "Sin conexión · los cambios locales se enviarán al reconectar"
            : status.syncError
              ? "Sincronización interrumpida"
              : attention > 0
                ? "Hay cambios que requieren atención"
                : !hasLocal
                  ? "Colecciones remotas · requieren conexión"
                  : !ready
                    ? "Preparando datos locales"
                    : "Datos locales disponibles";
  const tone: SyncTone =
    readError || status.authorizationError || status.syncError || attention > 0
      ? "error"
      : status.syncing
        ? "sync"
        : !online
          ? "warn"
          : !loaded || !hasLocal || !ready
            ? "neutral"
            : "ok";
  const StatusIcon = readError
    ? CloudOff
    : !loaded
      ? LoaderCircle
      : status.authorizationError
        ? Lock
        : status.syncing
          ? LoaderCircle
          : !online
            ? WifiOff
            : status.syncError || attention > 0
              ? CircleAlert
              : !hasLocal
                ? Cloud
                : !ready
                  ? LoaderCircle
                  : CheckCircle2;
  const statusSpin = StatusIcon === LoaderCircle;
  const syncLabel =
    busy || status.syncing
      ? "Sincronizando…"
      : status.syncError || readError
        ? "Reintentar sincronización"
        : "Sincronizar";
  const lastSyncedLabel =
    loaded && status.lastSyncedAt
      ? `Última comprobación: ${new Date(status.lastSyncedAt).toLocaleString()}`
      : null;
  const statusDetail = readError || status.syncError || error || null;
  const statusTooltip = statusDetail
    ? `${statusLabel}. ${statusDetail}`
    : statusLabel;
  const controlLabel = [
    ...(syncLabel === statusLabel ? [syncLabel] : [syncLabel, statusTooltip]),
    ...(lastSyncedLabel ? [lastSyncedLabel] : []),
  ].join(". ");
  return (
    <section
      aria-label="Sincronización local"
      className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border/60 bg-muted/20 px-3 py-1.5"
    >
      <span
        role="status"
        aria-live="polite"
        aria-label={statusTooltip}
        className="sr-only"
      >
        {statusTooltip}
      </span>
      {loaded && status.pending > 0 && (
        <span
          title={
            status.pending === 1
              ? "1 cambio pendiente de envío"
              : `${status.pending} cambios pendientes de envío`
          }
          className="inline-flex items-center rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300"
        >
          {status.pending === 1
            ? "1 cambio pendiente"
            : `${status.pending} cambios pendientes`}
        </span>
      )}
      <Button
        size="icon"
        variant="ghost"
        aria-label={controlLabel}
        title={controlLabel}
        disabled={busy || Boolean(status.syncing) || !online}
        onClick={() => void act(workspace.syncNow, false)}
        className={cn(
          "size-7 rounded-full border",
          tone === "ok" &&
            "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
          tone === "error" &&
            "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400",
          tone === "warn" &&
            "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
          tone === "sync" &&
            "border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-400",
          tone === "neutral" &&
            "border-border bg-muted/40 text-muted-foreground",
        )}
      >
        {busy || status.syncing ? (
          <LoaderCircle aria-hidden className="size-4 animate-spin" />
        ) : (
          <StatusIcon
            aria-hidden
            className={cn("size-4", statusSpin && "animate-spin")}
          />
        )}
      </Button>
      {attention > 0 && (
        <details className="w-full">
          <summary
            title={`${attention} cambios requieren atención`}
            className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-full border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-[11px] font-medium text-red-600 dark:text-red-400 [&::-webkit-details-marker]:hidden"
          >
            <CircleAlert aria-hidden className="size-3.5" />
            {attention} requieren atención
          </summary>
          <ul className="grid gap-3 py-3">
            {problems.map((op) => (
              <li
                key={op.mutationId}
                className="flex flex-wrap items-center gap-2"
              >
                <span className="min-w-0 break-words">
                  {op.collection}: {op.id}
                  {op.action === "bundle" &&
                    ` · Formulario completo (${op.bundle?.members.length ?? 1} registros)`}
                  {" — "}
                  {op.error}
                </span>
                {op.action === "bundle" ? (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={
                        busy || !online || Boolean(status.authorizationError)
                      }
                      onClick={() =>
                        void act(() =>
                          workspace.resolveBundle(op.mutationId, "server"),
                        )
                      }
                    >
                      Usar versión del servidor
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={
                        busy || !online || Boolean(status.authorizationError)
                      }
                      onClick={() =>
                        void act(() =>
                          workspace.resolveBundle(op.mutationId, "local"),
                        )
                      }
                    >
                      Conservar mis cambios
                    </Button>
                  </>
                ) : (
                  op.state === "conflict" && (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onClick={() =>
                          void act(() =>
                            workspace.store.acceptMaster(op.mutationId),
                          )
                        }
                      >
                        Usar versión del servidor
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy || deletedConflicts.has(op.mutationId)}
                        onClick={() =>
                          void act(() =>
                            workspace.store.retryWithLocal(op.mutationId),
                          )
                        }
                      >
                        Conservar mis cambios
                      </Button>
                    </>
                  )
                )}
                {op.action !== "bundle" && op.state === "error" && (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy || Boolean(status.authorizationError)}
                      onClick={() =>
                        void act(() =>
                          workspace.store.retryMutation(op.mutationId),
                        )
                      }
                    >
                      Reintentar
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        void act(() =>
                          workspace.store.discardMutation(op.mutationId),
                        )
                      }
                    >
                      Descartar cambio
                    </Button>
                  </>
                )}
                {deletedConflicts.has(op.mutationId) && (
                  <span>
                    El registro fue eliminado en el servidor. Restáuralo con
                    conexión antes de conservar tus cambios.
                  </span>
                )}
              </li>
            ))}
          </ul>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const blob = new Blob([JSON.stringify(problems, null, 2)], {
                type: "application/json",
              });
              const url = URL.createObjectURL(blob);
              const link = document.createElement("a");
              link.href = url;
              link.download = "cambios-pendientes.json";
              link.click();
              URL.revokeObjectURL(url);
            }}
          >
            Descargar cambios pendientes
          </Button>
        </details>
      )}
      {statusDetail && (
        <span role="alert" aria-label={statusDetail} className="sr-only">
          {statusDetail}
        </span>
      )}
    </section>
  );
}
