const observedRegistrations = new WeakSet<ServiceWorkerRegistration>();
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
