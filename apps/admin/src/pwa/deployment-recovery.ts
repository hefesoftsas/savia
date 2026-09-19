/** Match asset-loader failures, not ordinary API/network failures. */
export function isModuleLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : "";
  return /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Loading (?:CSS )?chunk [\w-]+ failed|Unable to preload CSS for/i.test(
    message,
  );
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
    pathname === "/public/forms" ||
    pathname.startsWith("/public/forms/") ||
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
    }, 15000);
  });
  try {
    await Promise.race([
      deadline,
      (async () => {
        const registration = await navigator.serviceWorker.register(
          import.meta.env.DEV ? "/dev-sw.js?dev-sw" : "/sw.js",
          { scope: "/", updateViaCache: "none" },
        );
        if (controller.signal.aborted) throw controller.signal.reason;
        await registration.update();
        if (controller.signal.aborted) throw controller.signal.reason;
        const worker =
          registration.installing ??
          registration.waiting ??
          registration.active;
        if (!worker)
          throw new Error(
            "La actualización todavía no está disponible. Reintenta en unos segundos.",
          );
        await waitForActivation(worker, controller.signal);
      })(),
    ]);
  } finally {
    clearTimeout(timer!);
    controller.abort();
  }
}

export async function reloadApplication() {
  await prepareAppReload();
  window.location.reload();
}
