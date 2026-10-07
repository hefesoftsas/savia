// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import {
  registerPwaServiceWorker,
  retireAdministrativeWorkerForPublicRoute,
} from "./register-service-worker";

afterEach(() => vi.restoreAllMocks());
it("registers after lazy private bootstrap even when window load already fired", async () => {
  const register = vi.fn().mockResolvedValue({
    scope: "/",
    update: vi.fn().mockResolvedValue(undefined),
  });
  vi.spyOn(document, "readyState", "get").mockReturnValue("complete");
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: { register },
  });
  registerPwaServiceWorker();
  expect(register).toHaveBeenCalledOnce();
});
it("waits for load while the private page is still loading", () => {
  const register = vi.fn().mockResolvedValue({
    scope: "/",
    update: vi.fn().mockResolvedValue(undefined),
  });
  vi.spyOn(document, "readyState", "get").mockReturnValue("loading");
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: { register },
  });
  registerPwaServiceWorker();
  expect(register).not.toHaveBeenCalled();
  window.dispatchEvent(new Event("load"));
  window.dispatchEvent(new Event("load"));
  expect(register).toHaveBeenCalledOnce();
});

it("checks for updates on reconnect and visibility with a one-minute throttle", async () => {
  vi.spyOn(document, "readyState", "get").mockReturnValue("complete");
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  const update = vi.fn().mockResolvedValue(undefined);
  const register = vi.fn().mockResolvedValue({ scope: "/", update });
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: { register },
  });
  registerPwaServiceWorker();
  await Promise.resolve();
  window.dispatchEvent(new Event("online"));
  document.dispatchEvent(new Event("visibilitychange"));
  expect(update).toHaveBeenCalledOnce();
  expect(register).toHaveBeenCalledWith(expect.any(String), {
    scope: "/",
    updateViaCache: "none",
  });
});

it("unregisters an existing admin worker and reloads public visitor routes", async () => {
  const controller = { scriptURL: `${window.location.origin}/sw.js` };
  const unregister = vi.fn().mockResolvedValue(true);
  const registration = {
    scope: `${window.location.origin}/`,
    active: controller,
    installing: null,
    waiting: null,
    unregister,
  };
  const getRegistration = vi.fn().mockResolvedValue(registration);
  const reload = vi.fn();

  await retireAdministrativeWorkerForPublicRoute(
    "/public/quotes/" + "a".repeat(64),
    { controller, getRegistration } as unknown as ServiceWorkerContainer,
    reload,
  );

  expect(getRegistration).toHaveBeenCalledWith("/");
  expect(unregister).toHaveBeenCalledOnce();
  expect(reload).toHaveBeenCalledOnce();
});

it("leaves first-time public visitors and unrelated service workers alone", async () => {
  const reload = vi.fn();
  const getRegistration = vi.fn();
  await retireAdministrativeWorkerForPublicRoute(
    "/public/quotes/" + "a".repeat(64),
    { controller: null, getRegistration } as unknown as ServiceWorkerContainer,
    reload,
  );
  await retireAdministrativeWorkerForPublicRoute(
    "/public/quotes/" + "a".repeat(64),
    {
      controller: {
        scriptURL: `${window.location.origin}/other-worker.js`,
      },
      getRegistration,
    } as unknown as ServiceWorkerContainer,
    reload,
  );
  await retireAdministrativeWorkerForPublicRoute(
    "/private",
    {
      controller: { scriptURL: `${window.location.origin}/sw.js` },
      getRegistration,
    } as unknown as ServiceWorkerContainer,
    reload,
  );
  expect(getRegistration).not.toHaveBeenCalled();
  expect(reload).not.toHaveBeenCalled();
});

it("does not reload when unregister reports that the registration remains", async () => {
  const controller = { scriptURL: `${window.location.origin}/sw.js` };
  const registration = {
    scope: `${window.location.origin}/`,
    active: controller,
    unregister: vi.fn().mockResolvedValue(false),
  };
  const reload = vi.fn();
  await retireAdministrativeWorkerForPublicRoute(
    "/public/quotes/" + "b".repeat(64),
    {
      controller,
      getRegistration: vi.fn().mockResolvedValue(registration),
    } as unknown as ServiceWorkerContainer,
    reload,
  );
  expect(registration.unregister).toHaveBeenCalledOnce();
  expect(reload).not.toHaveBeenCalled();
});

it("bounds a stalled service-worker lookup and releases its retry guard", async () => {
  vi.useFakeTimers();
  try {
    const controller = { scriptURL: `${window.location.origin}/sw.js` };
    const getRegistration = vi.fn().mockReturnValue(new Promise(() => {}));
    const serviceWorker = {
      controller,
      getRegistration,
    } as unknown as ServiceWorkerContainer;
    const reload = vi.fn();
    const retirement = retireAdministrativeWorkerForPublicRoute(
      "/public/quotes/" + "c".repeat(64),
      serviceWorker,
      reload,
    );
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(retirement).resolves.toBe(false);
    expect(reload).not.toHaveBeenCalled();
    getRegistration.mockResolvedValue({
      scope: `${window.location.origin}/`,
      active: controller,
      unregister: vi.fn().mockResolvedValue(true),
    });
    await expect(
      retireAdministrativeWorkerForPublicRoute(
        "/public/quotes/" + "c".repeat(64),
        serviceWorker,
        reload,
      ),
    ).resolves.toBe(true);
    expect(reload).toHaveBeenCalledOnce();
  } finally {
    vi.useRealTimers();
  }
});
