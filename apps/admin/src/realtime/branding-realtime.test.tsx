import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AppServicesProvider } from "@/features/assistant/assistant-context";
import type { CurrentTenantInfo } from "@/features/tenants/use-current-tenant";
import { BrandingRealtimeSync } from "./branding-realtime";

const state = vi.hoisted(() => ({
  tenant: {} as CurrentTenantInfo,
  refetch: vi.fn(),
}));
vi.mock("@/features/tenants/use-current-tenant", () => ({
  useCurrentTenant: () => state.tenant,
}));
vi.mock("@/features/tenant-branding/tenant-branding-provider", () => ({
  useTenantBranding: () => ({ refetch: state.refetch }),
}));

beforeEach(() => {
  state.tenant = {
    id: null,
    name: "Savia",
    kind: "platform",
    slug: null,
    monogram: "S",
    isDedicated: false,
    isLoading: false,
    isPlatformAdmin: false,
    scopeStatus: "platform",
  };
  vi.stubGlobal(
    "WebSocket",
    class {
      close() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function fixture() {
  const post = vi.fn().mockImplementation(async (_path, body) => ({
    data: {
      room: `tenant:${body.tenantId}`,
      ticket: "branding-ticket",
      topics: ["settings"],
      expiresAt: new Date(Date.now() + 15_000).toISOString(),
    },
  }));
  const services = { apiClient: { post } } as never;
  const view = render(
    <AppServicesProvider services={services}>
      <BrandingRealtimeSync />
    </AppServicesProvider>,
  );
  return {
    post,
    rerender: () =>
      view.rerender(
        <AppServicesProvider services={services}>
          <BrandingRealtimeSync />
        </AppServicesProvider>,
      ),
  };
}

it("does not request platform workspace tickets for a regular account", async () => {
  const { post } = fixture();
  await act(async () => {});
  expect(post).not.toHaveBeenCalled();
});

it.each([null, 0, -1, Number.NaN])(
  "does not fall back to tenant zero when dedicated tenant resolution returns %s",
  async (id) => {
    state.tenant = {
      ...state.tenant,
      isDedicated: true,
      isPlatformAdmin: true,
      kind: "commercial",
      scopeStatus: "error",
      id,
    };
    const { post } = fixture();
    await act(async () => {});
    expect(post).not.toHaveBeenCalled();
  },
);

it("subscribes only after the dedicated tenant resolves and uses its ID", async () => {
  state.tenant = {
    ...state.tenant,
    isDedicated: true,
    kind: "commercial",
    isLoading: true,
    scopeStatus: "loading",
  };
  const { post, rerender } = fixture();
  await act(async () => {});
  expect(post).not.toHaveBeenCalled();
  state.tenant = {
    ...state.tenant,
    isLoading: false,
    scopeStatus: "resolved",
    id: 42,
  };
  rerender();
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith("/v1/realtime/ticket", {
      topics: ["settings"],
      tenantId: 42,
    }),
  );
  expect(post).toHaveBeenCalledTimes(1);
});

it("preserves platform workspace subscriptions for platform administrators", async () => {
  state.tenant.isPlatformAdmin = true;
  const { post } = fixture();
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith("/v1/realtime/ticket", {
      topics: ["settings"],
      tenantId: 0,
    }),
  );
});
