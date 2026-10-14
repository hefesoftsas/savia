import { PUBLIC_VISITOR_ROUTE_DENYLIST } from "./deployment-recovery";

const observedRegistrations = new WeakSet<ServiceWorkerRegistration>();
const retiringControllers = new WeakSet<ServiceWorker>();
const PUBLIC_WORKER_RETIRE_DEADLINE_MS = 5_000;

/**
 * An older administrative worker may still serve its cached private shell for
 * a newly added public route. Drop only that root worker, then reload once so
 * the browser requests the public document without the stale controller.
 */
export async function retireAdministrativeWorkerForPublicRoute(
  pathname: string,
  serviceWorker: ServiceWorkerContainer,
  reload: () => void,
): Promise<boolean> {
  const publicRoute =
    pathname === "/register" ||
    PUBLIC_VISITOR_ROUTE_DENYLIST.some((pattern) => pattern.test(pathname)) ||
    pathname === "/office" ||
    pathname.startsWith("/office/");
  const controller = serviceWorker.controller;
  if (!publicRoute || !controller || retiringControllers.has(controller))
    return false;

  let script: URL;
  try {
    script = new URL(controller.scriptURL);
  } catch {
    return false;
  }
  if (
    script.origin !== window.location.origin ||
    (script.pathname !== "/sw.js" && script.pathname !== "/dev-sw.js")
  )
    return false;

  retiringControllers.add(controller);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let retired = false;
  let timedOut = false;
  let unregisterStarted = false;
  let operationSettled = false;
  let reloadIssued = false;
  const reloadOnce = () => {
    if (reloadIssued) return;
    reloadIssued = true;
    reload();
  };
  const retirement = (async () => {
    const registration = await serviceWorker.getRegistration("/");
    if (
      timedOut ||
      !registration ||
      registration.scope !== new URL("/", window.location.origin).href ||
      registration.active?.scriptURL !== controller.scriptURL
    )
      return;
    unregisterStarted = true;
    retired = await registration.unregister();
    if (retired && timedOut) reloadOnce();
  })().finally(() => {
    operationSettled = true;
    if (!retired) retiringControllers.delete(controller);
  });
  try {
    await Promise.race([
      retirement,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          reject(new Error("Service worker retirement timed out"));
        }, PUBLIC_WORKER_RETIRE_DEADLINE_MS);
      }),
    ]);
    if (retired) reloadOnce();
    return retired;
  } catch {
    // Keep the current page usable when storage or worker APIs fail. The
    // service worker's ordinary update lifecycle remains available on return.
    if (!unregisterStarted) retiringControllers.delete(controller);
    return false;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (operationSettled && !retired) retiringControllers.delete(controller);
  }
}

/**
 * Registers the PWA Service Worker in both development and production environments.
 */
export function registerPwaServiceWorker(): void {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
    return;
  }

  const register = () => {
    const swUrl = import.meta.env.DEV ? "/dev-sw.js?dev-sw" : "/sw.js";

    navigator.serviceWorker
      .register(swUrl, { scope: "/", updateViaCache: "none" })
      .then((registration) => {
        if (!observedRegistrations.has(registration)) {
          observedRegistrations.add(registration);
          let lastCheck = -Infinity;
          const check = () => {
            if (
              document.visibilityState !== "visible" ||
              navigator.onLine === false ||
              Date.now() - lastCheck < 60_000
            )
              return;
            lastCheck = Date.now();
            void registration.update().catch(() => undefined);
          };
          window.addEventListener("online", check);
          document.addEventListener("visibilitychange", check);
        }
        if (import.meta.env.DEV) {
          console.debug(
            "[PWA] Service worker registered successfully:",
            registration.scope,
          );
        }
      })
      .catch((error: unknown) => {
        if (import.meta.env.DEV) {
          console.debug("[PWA] Service worker registration notice:", error);
        }
      });
  };
  if (document.readyState === "complete") register();
  else window.addEventListener("load", register, { once: true });
}
