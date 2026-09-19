/**
 * Registers the PWA Service Worker in both development and production environments.
 */
export function registerPwaServiceWorker(): void {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
    return;
  }

  window.addEventListener("load", () => {
    const swUrl = import.meta.env.DEV ? "/dev-sw.js?dev-sw" : "/sw.js";

    navigator.serviceWorker
      .register(swUrl, { scope: "/" })
      .then((registration) => {
        if (import.meta.env.DEV) {
          console.debug("[PWA] Service worker registered successfully:", registration.scope);
        }
      })
      .catch((error: unknown) => {
        if (import.meta.env.DEV) {
          console.debug("[PWA] Service worker registration notice:", error);
        }
      });
  });
}
