import { useEffect, useState } from "react";
import { useTranslate } from "ra-core";
import {
  Check,
  ChevronDown,
  LoaderCircle,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useOutbox } from "./use-outbox";
import type { OutboxOp } from "./outbox";

function opLabel(op: OutboxOp, translate?: (key: string, options?: any) => string): string {
  if (op.action === "save-appearance") {
    return translate
      ? translate("savia.offline.appearanceOp", { _: "Apariencia" })
      : "Apariencia";
  }
  if (op.action === "save-sidebar") {
    return translate
      ? translate("savia.offline.sidebarOp", { _: "Menú lateral" })
      : "Menú lateral";
  }
  return `${op.resource}:${op.action}`;
}

/**
 * Pending-changes indicator rendered at the app root. Hidden when the queue
 * is empty so it never adds noise; expands to retry/discard per operation.
 */
export function OutboxStatus() {
  const { ops, flushing, refresh, retry, discard } = useOutbox();
  const translate = useTranslate();
  const [open, setOpen] = useState(false);

  // Ops can be enqueued from other components (sidebar, appearance), so
  // re-read periodically and on focus/online, not just on own actions.
  useEffect(() => {
    const update = () => void refresh();
    const timer = setInterval(update, 5000);
    window.addEventListener("online", update);
    window.addEventListener("focus", update);
    return () => {
      clearInterval(timer);
      window.removeEventListener("online", update);
      window.removeEventListener("focus", update);
    };
  }, [refresh]);

  if (ops.length === 0) return null;

  return (
    <div className="fixed bottom-16 left-4 z-50 w-72 rounded-lg border bg-card text-card-foreground shadow-md">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full cursor-pointer items-center justify-between gap-2 px-3 py-2 text-sm font-medium"
      >
        <span className="inline-flex items-center gap-2">
          {flushing ? (
            <LoaderCircle className="size-4 animate-spin" aria-hidden />
          ) : (
            <span aria-hidden className="size-2 rounded-full bg-amber-500" />
          )}
          {translate("savia.offline.pendingChanges", {
            count: ops.length,
            _: `Cambios pendientes (${ops.length})`,
          })}
        </span>
        <ChevronDown
          aria-hidden
          className={`size-4 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <ul className="max-h-56 space-y-1 overflow-y-auto border-t px-2 py-2">
          {ops.map((op) => {
            const label = opLabel(op, translate);
            return (
              <li
                key={op.id}
                className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">
                    {label}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {op.status === "failed"
                      ? (op.error ?? translate("savia.offline.syncFailed", { _: "Falló la sincronización." }))
                      : translate("savia.offline.willSyncOnReconnect", { _: "Se sincronizará al reconectar." })}
                  </span>
                </span>
                <span className="flex shrink-0 gap-1">
                  {op.status === "failed" && op.id !== undefined && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={translate("savia.offline.retry", {
                        label,
                        _: `Reintentar ${label}`,
                      })}
                      onClick={() => void retry(op.id!)}
                    >
                      <RotateCcw className="size-4" aria-hidden />
                    </Button>
                  )}
                  {op.id !== undefined && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={translate("savia.offline.discard", {
                        label,
                        _: `Descartar ${label}`,
                      })}
                      onClick={() => void discard(op.id!)}
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </Button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {open && (
        <p className="flex items-center gap-1.5 border-t px-3 py-2 text-xs text-muted-foreground">
          <Check className="size-3.5" aria-hidden />
          {translate("savia.offline.safeNotice", {
            _: "Nada destructivo se encola: solo preferencias personales.",
          })}
        </p>
      )}
    </div>
  );
}
