import { Component, useEffect, useState, type ReactNode } from "react";
import { isModuleLoadError, reloadApplication } from "./deployment-recovery";
import { registerPwaServiceWorker } from "./register-service-worker";
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
const reloadActivatedShell = () => window.location.reload();

/** Subscribe before registration so a fast activation cannot be missed. */
export function DeploymentUpdateNotice({
  reload = reloadActivatedShell,
}: { reload?: () => void } = {}) {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const workers = navigator.serviceWorker;
    let controller = workers.controller;
    let pending = false;
    let reloading = false;
    const edited = new Set<Element>();
    const rememberEdit = (event: Event) => {
      if (event.target instanceof Element) edited.add(event.target);
    };
    const apply = () => {
      if (
        !pending ||
        reloading ||
        document.visibilityState !== "visible" ||
        navigator.onLine === false
      )
        return;
      for (const element of edited) {
        if (!element.isConnected) edited.delete(element);
      }
      // Custom editors and embedded apps do not all expose dirty state. Keep
      // their current document until they close, even if they appear pristine.
      if (
        edited.size ||
        [
          ...document.querySelectorAll(
            'form, textarea, [contenteditable]:not([contenteditable="false"]), iframe, [role="dialog"], [aria-busy="true"]',
          ),
        ].some((element) => {
          for (
            let node: Element | null = element;
            node;
            node = node.parentElement
          ) {
            const style = window.getComputedStyle(node);
            if (
              node.hasAttribute("hidden") ||
              style.display === "none" ||
              style.visibility === "hidden"
            )
              return false;
          }
          return true;
        })
      )
        return;
      // Honor existing unsaved-change and undoable-mutation guards without
      // navigating or opening a browser confirmation dialog.
      const guard = new Event("beforeunload", { cancelable: true });
      if (!window.dispatchEvent(guard)) return;
      reloading = true;
      observer.disconnect();
      // This worker has already installed its shell. No second update request,
      // unregister, cache clearing, or recovery round trip is necessary.
      reload();
    };
    const observer = new MutationObserver(apply);
    const changed = () => {
      const next = workers.controller;
      if (!next || next === controller) return;
      const replacement = !!controller;
      controller = next;
      if (!replacement) return; // First installation must not reload the app.
      pending = true;
      setAvailable(true);
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: [
          "aria-busy",
          "contenteditable",
          "role",
          "hidden",
          "style",
          "class",
        ],
      });
      apply();
    };
    workers.addEventListener("controllerchange", changed);
    document.addEventListener("input", rememberEdit, true);
    document.addEventListener("change", rememberEdit, true);
    document.addEventListener("visibilitychange", apply);
    window.addEventListener("online", apply);
    registerPwaServiceWorker();
    return () => {
      observer.disconnect();
      workers.removeEventListener("controllerchange", changed);
      document.removeEventListener("input", rememberEdit, true);
      document.removeEventListener("change", rememberEdit, true);
      document.removeEventListener("visibilitychange", apply);
      window.removeEventListener("online", apply);
    };
  }, [reload]);
  if (!available) return null;
  return (
    <aside
      role="status"
      className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b bg-background px-4 py-3"
    >
      <div>
        <p className="font-medium">Hay una nueva versión disponible.</p>
        <p className="text-sm text-muted-foreground">
          La aplicación se actualizará automáticamente al cerrar los formularios
          y editores abiertos. Guarda tus cambios antes de cerrarlos.
        </p>
      </div>
      <ReloadButton />
    </aside>
  );
}
