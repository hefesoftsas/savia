import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { AppServices } from "@/app-services";
import { AppServicesProvider } from "@/features/assistant/assistant-context";
import { SaviaRequestProvider } from "./savia-request-provider";
import { SaviaRequestScopeBar } from "./savia-request-scope-bar";

vi.mock("ra-core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ra-core")>()),
  useCanAccess: () => ({ canAccess: true, isPending: false }),
  usePermissions: () => ({
    permissions: { canManageIdentity: true, memberships: [] },
  }),
}));

vi.mock("@/features/tenants/use-current-tenant", () => ({
  useCurrentTenant: () => ({
    isDedicated: false,
    slug: null,
    name: "Savia",
    kind: "platform",
    id: null,
    monogram: "S",
    isPlatformAdmin: true,
    isLoading: false,
  }),
  formatSlugToDisplayName: (slug: string) => slug,
}));

function renderScopeBar() {
  const get = vi.fn(async (rawPath: string) => {
    const path = rawPath.split("?")[0];
    if (path === "/v1/tenants")
      return {
        data: [
          { id: 101, name: "Acme", kind: "commercial" },
          { id: 202, name: "Beta", kind: "commercial" },
          { id: 0, name: "Plataforma", kind: "platform" },
        ],
      };
    if (path.endsWith("/flows")) return [];
    if (path.endsWith("/folders")) return [];
    throw new Error(`Ruta inesperada: ${rawPath}`);
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
          <SaviaRequestScopeBar />
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

describe("SaviaRequestScopeBar platform picker", () => {
  it("lists commercial tenants and scopes requests on selection", async () => {
    const user = userEvent.setup();
    const { get } = renderScopeBar();
    const select = await screen.findByRole("combobox", {
      name: "Inspeccionar tenant",
    });

    expect(
      await screen.findByRole("option", { name: "Acme (#101)" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: "Plataforma (#0)" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/Catálogo compartido de plataforma/)).toBeVisible();

    await user.selectOptions(select, "agency:101");
    await waitFor(() =>
      expect(get).toHaveBeenCalledWith(
        expect.stringContaining("?tenant=agency%3A101"),
      ),
    );
    expect(await screen.findByText("Ámbito:", { exact: false })).toBeVisible();
  });
});
