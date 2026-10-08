import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { useStudioSidebarNavigation } from "./use-studio-sidebar-navigation";

type RealtimeOptions = {
  topics: string[];
  tenantId?: number;
  enabled?: boolean;
  onConnected?: () => void;
  onEvent?: (event: {
    topic: string;
    type: "created" | "updated" | "deleted";
    collection?: string;
  }) => void;
};

const { transport, studioTenants, mockedServices } = vi.hoisted(() => ({
  transport: vi.fn((_options: RealtimeOptions) => ({
    status: "live" as const,
  })),
  studioTenants: vi.fn(),
  mockedServices: {
    apiClient: {
      get: vi.fn(async () => ({
        data: [{ name: "claims", label: "After" }],
      })),
    },
    localData: {
      cachedMetadata: vi.fn(async () => ({
        data: [{ name: "claims", label: "Before" }],
      })),
    },
  },
}));

vi.mock("@/realtime/use-realtime", () => ({
  useRealtimeTopics: transport,
}));
vi.mock("@/features/assistant/assistant-context", () => ({
  useAppServices: () => mockedServices,
}));
vi.mock("@/i18n/core", () => ({ useAppLocale: () => "es" }));
vi.mock("./studio-tenants", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./studio-tenants")>()),
  listStudioTenants: studioTenants,
}));

const tenant = {
  id: "tenant:42",
  tenantId: 42,
  label: "North",
  kind: "tenant",
  apiBasePath: "/v1/studio/42",
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("refreshes cached Studio sidebar metadata on the first tenant socket acknowledgement", async () => {
  studioTenants.mockResolvedValue([tenant]);
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <MemoryRouter initialEntries={["/studio?tenantId=42"]}>
      {children}
    </MemoryRouter>
  );
  const { result } = renderHook(() => useStudioSidebarNavigation(true), {
    wrapper,
  });

  await waitFor(() => {
    expect(
      result.current.children.find((child) => child.id === "object:claims")
        ?.label,
    ).toBe("Before");
  });
  expect(mockedServices.localData.cachedMetadata).toHaveBeenCalledOnce();

  const studioConnection = transport.mock.calls
    .map(([options]) => options)
    .reverse()
    .find(
      (options) =>
        options.enabled &&
        options.tenantId === 42 &&
        options.topics.includes("studio"),
    );
  expect(studioConnection).toBeDefined();

  act(() => studioConnection?.onConnected?.());

  await waitFor(() => {
    expect(
      result.current.children.find((child) => child.id === "object:claims")
        ?.label,
    ).toBe("After");
  });
  expect(mockedServices.apiClient.get).toHaveBeenCalledWith(
    "/v1/studio/42/api/objects",
  );
});
