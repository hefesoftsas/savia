import { describe, expect, it, vi } from "vitest";
import { createAppServices } from "./app-services";

describe("app services offline wipe", () => {
  it("keeps auth queries mounted until asynchronous workspace cleanup finishes", async () => {
    const services = createAppServices();
    services.queryClient.setQueryData(["auth", "checkAuth"], true);
    let finishCleanup!: () => void;
    let startCleanup!: () => void;
    const cleanupStarted = new Promise<void>((resolve) => {
      startCleanup = resolve;
    });
    vi.spyOn(services.localData, "clear").mockImplementation(() => {
      startCleanup();
      return new Promise<void>((resolve) => {
        finishCleanup = resolve;
      });
    });
    const logout = services.authProvider.logout({});
    await cleanupStarted;
    const authWhileCleaning = services.queryClient.getQueryData([
      "auth",
      "checkAuth",
    ]);
    finishCleanup();
    await logout;
    expect(authWhileCleaning).toBe(true);
    expect(
      services.queryClient.getQueryData(["auth", "checkAuth"]),
    ).toBeUndefined();
  });
  it("clears cached queries on logout so no client data survives the session", async () => {
    const services = createAppServices();
    services.queryClient.setQueryData(["users", "getList", {}], {
      data: [{ id: "p-1" }],
      total: 1,
    });
    services.queryClient.setQueryData(["pipeline", "cotizaciones", {}], {
      data: [],
    });

    await services.authProvider.logout({});

    expect(
      services.queryClient.getQueryData(["users", "getList", {}]),
    ).toBeUndefined();
    expect(
      services.queryClient.getQueryData(["pipeline", "cotizaciones", {}]),
    ).toBeUndefined();
  });
});
