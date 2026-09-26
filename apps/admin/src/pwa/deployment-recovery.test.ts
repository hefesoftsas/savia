import { afterEach, expect, it, vi } from "vitest";
import { isModuleLoadError, prepareAppReload } from "./deployment-recovery";
afterEach(() => vi.restoreAllMocks());
class Worker extends EventTarget {
  state: ServiceWorkerState = "installing";
  postMessage = vi.fn();
  transition(state: ServiceWorkerState) {
    this.state = state;
    this.dispatchEvent(new Event("statechange"));
  }
}
function environment(registration: unknown) {
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: { register: vi.fn().mockResolvedValue(registration) },
  });
}
it("recognizes obsolete module and stylesheet loads without swallowing ordinary application errors", () => {
  expect(
    isModuleLoadError(
      new TypeError(
        "Failed to fetch dynamically imported module: /assets/old.js",
      ),
    ),
  ).toBe(true);
  expect(
    isModuleLoadError(new TypeError("Importing a module script failed.")),
  ).toBe(true);
  expect(
    isModuleLoadError(new Error("Unable to preload CSS for /assets/old.css")),
  ).toBe(true);
  expect(isModuleLoadError(new Error("Failed to fetch"))).toBe(false);
  expect(isModuleLoadError(new Error("Permission denied"))).toBe(false);
});
it("waits for the replacement worker to activate before allowing reload", async () => {
  const worker = new Worker();
  const update = vi.fn().mockResolvedValue(undefined);
  environment({ update, installing: worker, waiting: null, active: null });
  let ready = false;
  const pending = prepareAppReload().then(() => {
    ready = true;
  });
  await vi.waitFor(() => expect(update).toHaveBeenCalledOnce());
  expect(ready).toBe(false);
  worker.transition("installed");
  expect(worker.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
  worker.transition("activating");
  expect(ready).toBe(false);
  worker.transition("activated");
  await pending;
  expect(ready).toBe(true);
});
it("does not reload after update failure, redundant installation or offline requests", async () => {
  environment({
    update: vi.fn().mockRejectedValue(new Error("Update unavailable")),
    unregister: vi.fn(),
  });
  await expect(prepareAppReload()).rejects.toThrow("Update unavailable");
  const worker = new Worker();
  const unregister = vi.fn().mockResolvedValue(true);
  environment({
    update: vi.fn().mockResolvedValue(undefined),
    installing: worker,
    unregister,
  });
  const pending = prepareAppReload();
  await vi.waitFor(() =>
    expect(navigator.serviceWorker.register).toHaveBeenCalled(),
  );
  await Promise.resolve();
  await Promise.resolve();
  worker.transition("redundant");
  // Redundant install drops worker control and lets the caller reload from
  // the network instead of stranding the user on the timeout screen.
  await pending;
  expect(unregister).toHaveBeenCalledOnce();
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  await expect(prepareAppReload()).rejects.toThrow(/conexión/);
});
it("drops a stalled worker and reloads from network instead of stranding on timeout", async () => {
  vi.useFakeTimers();
  try {
    const unregister = vi.fn().mockResolvedValue(true);
    environment({
      update: vi.fn().mockResolvedValue(undefined),
      installing: new Worker(),
      unregister,
    });
    const pending = prepareAppReload();
    await vi.advanceTimersByTimeAsync(30_000);
    await pending;
    expect(unregister).toHaveBeenCalledOnce();
  } finally {
    vi.useRealTimers();
  }
});
it("keeps update failures retryable without unregistering", async () => {
  vi.useFakeTimers();
  try {
    const unregister = vi.fn();
    environment({
      update: vi.fn().mockRejectedValue(new Error("Update unavailable")),
      unregister,
    });
    const pending = prepareAppReload();
    const assertion = expect(pending).rejects.toThrow("Update unavailable");
    await vi.advanceTimersByTimeAsync(30_000);
    await assertion;
    expect(unregister).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});

it("does not register the private worker while recovering a public form", async () => {
  environment({ update: vi.fn() });
  const original = window.location.href;
  window.history.replaceState(
    null,
    "",
    "/public/forms/0123456789abcdef0123456789abcdef",
  );
  try {
    await prepareAppReload();
    expect(navigator.serviceWorker.register).not.toHaveBeenCalled();
  } finally {
    window.history.replaceState(null, "", original);
  }
});
