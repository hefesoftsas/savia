import { Component, useEffect, useState, type ReactNode } from "react";
import { isModuleLoadError, reloadApplication } from "./deployment-recovery";
import { PwaSpinner } from "./pwa-splash";

function ReloadButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <div className="grid gap-2">
      <button
        className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
        disabled={busy}
        aria-busy={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            await reloadApplication();
          } catch (e) {
            setError(
              e instanceof Error
                ? e.message
                : "No se pudo actualizar. Comprueba tu conexión y reintenta.",
            );
            setBusy(false);
          }
        }}
      >
        {busy ? (
          <>
            <PwaSpinner size="xs" />
            Buscando la nueva versión…
          </>
        ) : (
          "Actualizar y recargar"
        )}
      </button>
      {error && (
        <p role="alert" className="text-sm">
          {error}
        </p>
      )}
    </div>
  );
}
export function DeploymentRecovery({
  assetError = true,
}: {
  assetError?: boolean;
}) {
  return (
    <main className="flex min-h-0 flex-1 items-center justify-center p-6">
      <section
        className="grid w-full max-w-lg gap-4"
        aria-label="Recuperar aplicación"
      >
        <h1 className="text-2xl font-semibold">
          {assetError
            ? "Actualiza la aplicación"
            : "No se pudo abrir la aplicación"}
        </h1>
        <p>
          {assetError
            ? "No se pudo cargar una parte de la aplicación. Puede haber una nueva versión o una interrupción de conexión."
            : "Vuelve a cargar la aplicación para intentarlo de nuevo."}
        </p>
        <p className="text-sm text-muted-foreground">
          La actualización conserva tus datos locales y los cambios pendientes
          de sincronización. Los formularios que no hayas guardado se perderán
          al recargar.
        </p>
        <ReloadButton />
      </section>
    </main>
  );
}
export class DeploymentBoundary extends Component<
  { children: ReactNode },
  { error: unknown }
> {
  state: { error: unknown } = { error: null };
  static getDerivedStateFromError(error: unknown) {
    return { error };
  }
  render() {
    return this.state.error ? (
      <DeploymentRecovery assetError={isModuleLoadError(this.state.error)} />
    ) : (
      this.props.children
    );
  }
}
/** Notify without reloading: active forms may contain edits not yet saved locally. */
export function DeploymentUpdateNotice() {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    let controlled = !!navigator.serviceWorker.controller;
    const changed = () => {
      if (controlled) setAvailable(true);
      controlled = true;
    };
    navigator.serviceWorker.addEventListener("controllerchange", changed);
    return () =>
      navigator.serviceWorker.removeEventListener("controllerchange", changed);
  }, []);
  if (!available) return null;
  return (
    <aside
      role="status"
      className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b bg-background px-4 py-3"
    >
      <div>
        <p className="font-medium">Hay una nueva versión disponible.</p>
        <p className="text-sm text-muted-foreground">
          Guarda los formularios abiertos antes de actualizar. Tus cambios
          pendientes de sincronización se conservan.
        </p>
      </div>
      <ReloadButton />
    </aside>
  );
}
