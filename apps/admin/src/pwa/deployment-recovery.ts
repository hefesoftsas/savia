/** Match asset-loader failures, not ordinary API/network failures. */
export function isModuleLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : "";
  return /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Loading (?:CSS )?chunk [\w-]+ failed|Unable to preload CSS for/i.test(
    message,
  );
}

/** Hard deadline for the worker replacement. Boot shell precache is small by
 * design; 30s still covers slow 4G while keeping recovery retryable instead
 * of hanging forever. */
export const UPDATE_DEADLINE_MS = 30_000;
const UNREGISTER_DEADLINE_MS = 5_000;

async function removeStaleWorker(
  registration: ServiceWorkerRegistration,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const error = new Error(
    "No se pudo completar la actualización. Comprueba tu conexión y reintenta.",
  );
  try {
    await Promise.race([
      registration.unregister(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(error), UNREGISTER_DEADLINE_MS);
      }),
    ]);
  } catch {
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function waitForActivation(
  worker: ServiceWorker,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      worker.removeEventListener("statechange", check);
      signal.removeEventListener("abort", abort);
    };
    const abort = () => {
      cleanup();
      reject(signal.reason);
    };
    const check = () => {
      if (signal.aborted) return abort();
      if (worker.state === "activated") {
        cleanup();
        resolve();
      } else if (worker.state === "redundant") {
        cleanup();
        reject(
          new Error(
            "No se pudo instalar la nueva versión. Reintenta con conexión.",
          ),
        );
      } else if (worker.state === "installed")
        worker.postMessage({ type: "SKIP_WAITING" });
    };
    worker.addEventListener("statechange", check);
    signal.addEventListener("abort", abort, { once: true });
    check();
  });
}

/** Called only after user confirmation. Never clears caches, replicas, queues or credentials. */
export async function prepareAppReload(): Promise<void> {
  if (navigator.onLine === false)
    throw new Error(
      "Necesitas conexión para buscar la nueva versión. Tus datos locales se conservan.",
    );
  const pathname = window.location.pathname;
  // Public visitors must not download or initialize the administrative offline shell.
  if (
    pathname === "/register" ||
    pathname === "/public/forms" ||
    pathname.startsWith("/public/forms/") ||
    pathname === "/public/pages" ||
    pathname.startsWith("/public/pages/") ||
    pathname === "/office" ||
    pathname.startsWith("/office/") ||
    !("serviceWorker" in navigator)
  )
    return;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(
        "Se agotó el tiempo al actualizar. Comprueba tu conexión y reintenta.",
      );
      controller.abort(error);
      reject(error);
    }, UPDATE_DEADLINE_MS);
  });
  let registration: ServiceWorkerRegistration | undefined;
  let updateReachedServer = false;
  let needsNetworkReload = false;
  try {
    await Promise.race([
      deadline,
      (async () => {
        registration = await navigator.serviceWorker.register(
          import.meta.env.DEV ? "/dev-sw.js?dev-sw" : "/sw.js",
          { scope: "/", updateViaCache: "none" },
        );
        if (controller.signal.aborted) throw controller.signal.reason;
        await registration.update();
        updateReachedServer = true;
        if (controller.signal.aborted) throw controller.signal.reason;
        const replacement = registration.installing ?? registration.waiting;
        const worker = replacement ?? registration.active;
        if (!worker)
          throw new Error(
            "La actualización todavía no está disponible. Reintenta en unos segundos.",
          );
        await waitForActivation(worker, controller.signal);
        // An unchanged active worker can still serve the same retired shell.
        // A successful update check alone does not make that shell usable.
        needsNetworkReload = !replacement;
      })(),
    ]);
  } catch (error) {
    // The replacement worker was found on the server but its install stalled
    // (slow network, failed precache, redundant). The old controller would
    // keep serving the retired index.html, so every retry would hit the same
    // missing chunk. Drop service-worker control and let the caller reload
    // from the network, which already serves the new deployment. IndexedDB
    // replicas, outbox queues, caches and credentials are untouched: only
    // the worker registration is removed, and the next boot re-registers it.
    // Failures before reaching the server (offline, DNS, edge down) stay
    // retryable instead: reloading there would only show the browser offline
    // page and is worse than staying on this screen.
    if (
      updateReachedServer &&
      error instanceof Error &&
      !error.message.includes("todavía no está disponible")
    ) {
      needsNetworkReload = true;
    } else throw error;
  } finally {
    clearTimeout(timer!);
    controller.abort();
  }
  // Worker removal has its own bounded wait. Failure must reach the recovery
  // UI instead of hanging forever or reloading the same broken shell.
  if (needsNetworkReload && registration) await removeStaleWorker(registration);
}

export async function reloadApplication() {
  await prepareAppReload();
  window.location.reload();
}
