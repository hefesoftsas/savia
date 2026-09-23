import { useEffect, useState } from "react";
import { Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SidebarMenuItem } from "@/components/ui/sidebar";
import { useSaviaRequestWorkspace } from "./savia-request-provider";
import type { BundleStatus, BundleSyncResult } from "./types";

export function SaviaRequestBundleRow() {
  const { active, api, busy, refreshNavigation } = useSaviaRequestWorkspace();
  const [status, setStatus] = useState<BundleStatus | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setStatus(null);
    setMessage(null);
    api.bundleStatus().then(
      (next) => {
        if (!cancelled) setStatus(next);
      },
      () => {
        if (!cancelled) setStatus(null);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [active, api]);

  if (!active || !status) return null;

  const sync = async () => {
    setSyncing(true);
    setMessage(null);
    try {
      const result: BundleSyncResult = await api.syncBundle({});
      await refreshNavigation();
      const refreshed = await api.bundleStatus().catch(() => null);
      if (refreshed) setStatus(refreshed);
      const applied = result.updated.length + result.installed.length;
      const skipped = result.skippedCustomized.length;
      if (applied > 0)
        setMessage(
          `Paquete actualizado: ${applied} flow(s).` +
            (skipped
              ? ` ${skipped} personalizado(s) omitidos: restablécelos para actualizarlos.`
              : ""),
        );
      else if (skipped > 0)
        setMessage(
          `${skipped} personalizado(s) omitidos: restablécelos para actualizarlos.`,
        );
      else setMessage("Todo al día.");
    } catch {
      setMessage("No pudimos sincronizar el paquete.");
    } finally {
      setSyncing(false);
    }
  };

  const working = busy || syncing;
  return (
    <SidebarMenuItem>
      <div className="flex h-8 items-center gap-2 px-2 text-sm">
        <Package className="size-4 shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-left">
          Seguros v{status.installedVersion ?? status.currentVersion}
        </span>
        {status.updateAvailable ? (
          <span
            aria-label="Actualización disponible"
            title="Actualización disponible"
            className="size-2 shrink-0 rounded-full bg-amber-500"
          />
        ) : null}
      </div>
      {status.updateAvailable ? (
        <div className="px-2 pb-1">
          <Button
            disabled={working}
            onClick={() => void sync()}
            size="sm"
            type="button"
            variant="outline"
            className="h-7 text-xs"
          >
            {syncing ? "Actualizando…" : "Actualizar paquete"}
          </Button>
          {message ? (
            <p role="status" className="mt-1 text-xs text-muted-foreground">
              {message}
            </p>
          ) : null}
        </div>
      ) : null}
    </SidebarMenuItem>
  );
}
