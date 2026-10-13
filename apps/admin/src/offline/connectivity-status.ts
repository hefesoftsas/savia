// One in-memory connectivity check shared by all useOnlineStatus consumers.
// Browser offline hints are not authoritative in embedded browsers and VPNs.
const RETRY_MS = 60_000;
const TIMEOUT_MS = 8_000;
const listeners = new Set<() => void>();
let online = true;
let generation = 0;
let request: AbortController | undefined;
let retry: ReturnType<typeof setTimeout> | undefined;
let deadline: ReturnType<typeof setTimeout> | undefined;

const browserOnline = () =>
  typeof navigator === "undefined" || navigator.onLine !== false;
const visible = () => document.visibilityState !== "hidden";

export const getOnlineStatus = () =>
  listeners.size ? online : browserOnline();
export const getServerOnlineStatus = () => true;

function publish(value: boolean) {
  if (online === value) return;
  online = value;
  listeners.forEach((listener) => listener());
}

function cancel() {
  generation += 1;
  clearTimeout(retry);
  clearTimeout(deadline);
  retry = undefined;
  deadline = undefined;
  request?.abort();
  request = undefined;
}

async function probe() {
  if (!listeners.size || !visible() || request) return;
  if (browserOnline()) {
    publish(true);
    return;
  }
  const controller = new AbortController();
  request = controller;
  const currentGeneration = ++generation;
  deadline = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const origin = import.meta.env.VITE_SAVIA_API_URL ?? window.location.origin;
    const response = await fetch(new URL("/api/health", origin).toString(), {
      method: "HEAD",
      cache: "no-store",
      credentials: "omit",
      signal: controller.signal,
    });
    if (currentGeneration === generation) {
      // 401/403/5xx prove connectivity too. API failures belong to their query,
      // rather than being mislabeled as a browser network disconnection.
      publish(response.status >= 100 && response.status <= 599);
    }
  } catch {
    if (currentGeneration === generation) publish(false);
  } finally {
    if (currentGeneration === generation) {
      clearTimeout(deadline);
      deadline = undefined;
      request = undefined;
      if (listeners.size && visible() && !browserOnline()) {
        retry = setTimeout(() => {
          void probe();
        }, RETRY_MS);
      }
    }
  }
}

function browserChanged() {
  cancel();
  publish(browserOnline());
  if (!browserOnline()) void probe();
}

function visibilityChanged() {
  cancel();
  if (visible()) void probe();
}

export function subscribeOnlineStatus(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    online = browserOnline();
    window.addEventListener("online", browserChanged);
    window.addEventListener("offline", browserChanged);
    document.addEventListener("visibilitychange", visibilityChanged);
    void probe();
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      cancel();
      window.removeEventListener("online", browserChanged);
      window.removeEventListener("offline", browserChanged);
      document.removeEventListener("visibilitychange", visibilityChanged);
    }
  };
}
