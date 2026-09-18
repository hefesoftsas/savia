import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type { LocalWorkspace } from "./workspaces";
import type { Mutation, LocalStatus } from "./contracts";
import { useOnlineStatus } from "@/offline/use-online-status";

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
  const online = useOnlineStatus();
  useEffect(() => {
    let active = true;
    const refresh = () => {
      void Promise.all([
        workspace.store.status(),
        workspace.store.db.outbox.toArray(),
        workspace.store.db.syncState.toArray(),
        workspace.store.db.collections.toArray(),
        workspace.store.db.conflicts.toArray(),
      ])
        .then(([next, ops, states, collections, conflicts]) => {
          if (!active) return;
          setStatus(next);
          setProblems(ops.filter((op) => op.state !== "pending"));
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
        .catch(() => undefined);
    };
    refresh();
    const unsubscribe = workspace.store.subscribe(refresh);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [workspace]);
  const act = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await action();
      workspace.requestSync();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo sincronizar.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section
      aria-label="Sincronización local"
      className="flex flex-wrap items-center gap-2 border-b px-3 py-2 text-sm"
    >
      <span role="status" aria-live="polite" className="text-muted-foreground">
        {status.authorizationError
          ? "Acceso revocado · vuelve a iniciar sesión"
          : !hasLocal
            ? "Colecciones remotas · requieren conexión"
            : !ready
              ? "Preparando datos locales"
              : !online
                ? "Sin conexión · datos locales"
                : status.pending
                  ? `${status.pending} cambios pendientes`
                  : "Datos locales disponibles"}
      </span>
      <Button
        size="sm"
        variant="ghost"
        disabled={busy || !online}
        onClick={() => void act(workspace.syncNow)}
      >
        Sincronizar
      </Button>
      {status.conflicts + status.errors > 0 && (
        <details className="w-full">
          <summary className="cursor-pointer text-destructive">
            {status.conflicts + status.errors} cambios requieren atención
          </summary>
          <ul className="grid gap-3 py-3">
            {problems.map((op) => (
              <li
                key={op.mutationId}
                className="flex flex-wrap items-center gap-2"
              >
                <span className="min-w-0 break-words">
                  {op.collection}: {op.id} — {op.error}
                </span>
                {op.state === "conflict" && (
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
                )}
                {op.state === "error" && (
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
      {status.syncError && (
        <p role="alert" className="w-full text-destructive">
          {status.syncError}
        </p>
      )}
      {error && (
        <p role="alert" className="w-full text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
