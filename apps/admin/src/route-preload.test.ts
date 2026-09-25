import { describe, expect, it, vi } from "vitest";
import { preloadRouteModules } from "./route-preload";

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("preloadRouteModules", () => {
  it("preloads Studio and Savia Request only with access", async () => {
    const loadStudioPage = vi.fn().mockResolvedValue({});
    const loadSaviaRequestPage = vi.fn().mockResolvedValue({});
    const services = {
      authSession: {
        getPermissions: () =>
          Promise.resolve({
            canManageIdentity: true,
            memberships: [{ role: "tenant_admin" }],
          }),
      },
    };
    preloadRouteModules(
      services,
      { loadStudioPage, loadSaviaRequestPage },
      (callback) => callback(),
    );
    await flush();
    expect(loadStudioPage).toHaveBeenCalledTimes(1);
    expect(loadSaviaRequestPage).toHaveBeenCalledTimes(1);
  });

  it("skips preload without access and tolerates failures", async () => {
    const loadStudioPage = vi.fn().mockResolvedValue({});
    const loadSaviaRequestPage = vi
      .fn()
      .mockRejectedValueOnce(new Error("red caída"));
    const services = {
      authSession: {
        getPermissions: () =>
          Promise.resolve({ canManageIdentity: false, memberships: [] }),
      },
    };
    expect(() =>
      preloadRouteModules(
        services,
        { loadStudioPage, loadSaviaRequestPage },
        (callback) => callback(),
      ),
    ).not.toThrow();
    await flush();
    expect(loadStudioPage).not.toHaveBeenCalled();
    expect(loadSaviaRequestPage).not.toHaveBeenCalled();

    const adminServices = {
      authSession: {
        getPermissions: () =>
          Promise.resolve({ canManageIdentity: true, memberships: [] }),
      },
    };
    // Un fallo de precarga no bloquea: la ruta reintenta la importación.
    expect(() =>
      preloadRouteModules(
        adminServices,
        { loadStudioPage, loadSaviaRequestPage },
        (callback) => callback(),
      ),
    ).not.toThrow();
    await flush();
    expect(loadStudioPage).toHaveBeenCalled();
  });
});
