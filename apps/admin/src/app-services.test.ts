import { describe, expect, it } from "vitest";
import { createAppServices } from "./app-services";

describe("app services offline wipe", () => {
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
