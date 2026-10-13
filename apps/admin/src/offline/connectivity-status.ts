// One in-memory connectivity check shared by all useOnlineStatus consumers.
// Browser offline hints are not authoritative in embedded browsers and VPNs.
const RETRY_MS = 60_000;
const TIMEOUT_MS = 8_000;
const listeners = new Set<() => void>();
let online = true;
let generation = 0;
let explicitVerifications = 0;
let request: AbortController | undefined;
let completion: Promise<void> | undefined;
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
  completion = undefined;
}

function probe(explicit = false): Promise<void> {
  if (!listeners.size || (!explicit && !visible())) return Promise.resolve();
  if (completion) return completion;
  if (browserOnline()) {
    publish(true);
    return Promise.resolve();
  }
  clearTimeout(retry);
  retry = undefined;
  const controller = new AbortController();
  request = controller;
  const currentGeneration = ++generation;
  deadline = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const pending = performProbe(controller, currentGeneration);
  completion = pending;
  const settled = () => {
    if (completion === pending) completion = undefined;
  };
  void pending.then(settled, settled);
  return pending;
}

async function performProbe(
  controller: AbortController,
  currentGeneration: number,
) {
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

/** Recovery can run after ApplicationRoot and its subscribers were unmounted. */
export async function verifyOnlineStatus(): Promise<boolean> {
  if (getOnlineStatus()) return true;
  explicitVerifications += 1;
  const unsubscribe = subscribeOnlineStatus(() => {});
  try {
    await probe(true);
    return online;
  } finally {
    explicitVerifications -= 1;
    unsubscribe();
  }
}

function browserChanged() {
  if (explicitVerifications && !browserOnline()) return;
  cancel();
  publish(browserOnline());
  if (!browserOnline()) void probe();
}

function visibilityChanged() {
  // A user-requested recovery owns its bounded check across focus changes.
  if (explicitVerifications) return;
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
