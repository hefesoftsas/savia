import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { AppServices } from "@/app-services";
import { AppServicesProvider } from "@/features/assistant/assistant-context";
import { SaviaRequestProvider } from "./savia-request-provider";

vi.mock("ra-core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ra-core")>()),
  useCanAccess: () => ({ canAccess: true, isPending: false }),
  usePermissions: () => ({
    permissions: {
      canManageIdentity: false,
      memberships: [{ agencyId: 101, role: "agency_admin" }],
    },
  }),
}));

vi.mock("@/features/tenants/use-current-tenant", () => ({
  useCurrentTenant: () => ({
    isDedicated: true,
    slug: "acme",
    name: "Acme",
    kind: "commercial",
    id: 101,
    monogram: "A",
    isPlatformAdmin: false,
    isLoading: false,
  }),
  formatSlugToDisplayName: (slug: string) => slug,
}));

function renderScopedProvider() {
  const get = vi.fn(async (path: string) => {
    if (path.includes("/flows") && !path.includes("/flows/"))
      return [{ id: "autos", name: "Autos", steps: [] }];
    if (path.endsWith("/folders")) return [];
    throw new Error(`Ruta inesperada: ${path}`);
  });
  const services = {
    apiClient: {
      get,
      put: vi.fn(),
      post: vi.fn(),
      delete: vi.fn(),
      request: vi.fn(),
    },
  } as unknown as AppServices;

  render(
    <MemoryRouter initialEntries={["/savia-request"]}>
      <AppServicesProvider services={services}>
        <SaviaRequestProvider>
          <p>hijo</p>
        </SaviaRequestProvider>
      </AppServicesProvider>
    </MemoryRouter>,
  );
  return { get };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("SaviaRequestProvider tenant scope", () => {
  it("scopes every request to the dedicated tenant", async () => {
    const { get } = renderScopedProvider();

    await waitFor(() =>
      expect(get).toHaveBeenCalledWith(
        expect.stringContaining("?tenant=agency%3A101"),
      ),
    );
    for (const [path] of get.mock.calls)
      expect(String(path)).toContain("?tenant=agency%3A101");
    expect(await screen.findByText("hijo")).toBeVisible();
  });
});
