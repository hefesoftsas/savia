import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppServicesProvider } from "@/features/assistant/assistant-context";
import {
  applyOfflinePolicyDefaults,
  useOfflinePolicy,
} from "./use-offline-policy";
import {
  clearOfflinePolicySnapshots,
  getOfflinePolicySnapshot,
} from "./offline-policy";

afterEach(() => {
  cleanup();
  clearOfflinePolicySnapshots();
  vi.restoreAllMocks();
});

describe("applyOfflinePolicyDefaults", () => {
  it("sets per-collection refresh intervals", () => {
    const queryClient = new QueryClient();
    applyOfflinePolicyDefaults(queryClient, [
      { collection: "cotizaciones", enabled: true, refreshSeconds: 120 },
      { collection: "clientes", enabled: false, refreshSeconds: 300 },
    ]);

    expect(
      queryClient.getQueryDefaults(["pipeline", "cotizaciones"]),
    ).toMatchObject({ staleTime: 120_000, refetchInterval: 120_000 });
    expect(
      queryClient.getQueryDefaults(["summary", "cotizaciones"]),
    ).toMatchObject({ staleTime: 120_000, refetchInterval: 120_000 });
    expect(
      queryClient.getQueryDefaults(["pipeline", "clientes"]),
    ).toMatchObject({ staleTime: 0, refetchInterval: false });
  });

  it("ignores a missing client", () => {
    expect(() =>
      applyOfflinePolicyDefaults(undefined, [
        { collection: "cotizaciones", enabled: true, refreshSeconds: 60 },
      ]),
    ).not.toThrow();
  });
});

describe("useOfflinePolicy", () => {
  function Probe({ tenantId }: { tenantId?: number }) {
    useOfflinePolicy(tenantId);
    return <span data-testid="probe">ready</span>;
  }

  it("publishes the tenant snapshot and defaults", async () => {
    const apiClient = {
      get: vi.fn().mockResolvedValue({
        data: [{ collection: "polizas", enabled: true, refreshSeconds: 90 }],
      }),
    };
    const queryClient = new QueryClient();
    render(
      <AppServicesProvider services={{ apiClient } as never}>
        <QueryClientProvider client={queryClient}>
          <Probe tenantId={101} />
        </QueryClientProvider>
      </AppServicesProvider>,
    );

    await waitFor(() => {
      expect(apiClient.get).toHaveBeenCalledWith(
        "/v1/offline/collections?tenantId=101",
      );
    });
    await waitFor(() => {
      expect(getOfflinePolicySnapshot(101)?.enabled.has("polizas")).toBe(true);
    });
    expect(queryClient.getQueryDefaults(["pipeline", "polizas"])).toMatchObject(
      { staleTime: 90_000 },
    );
  });

  it("does nothing without providers or tenant", () => {
    render(<Probe />);
    expect(screen.getByTestId("probe")).toBeInTheDocument();
    expect(getOfflinePolicySnapshot(101)).toBeUndefined();
  });
});
