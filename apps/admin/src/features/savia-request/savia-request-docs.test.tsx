import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { AppServices } from "@/app-services";
import { AppServicesProvider } from "@/features/assistant/assistant-context";
import { SaviaRequestProvider } from "./savia-request-provider";
import { SaviaRequestDocs } from "./savia-request-docs";

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

vi.mock("@scalar/api-reference-react", () => ({
  ApiReferenceReact: ({
    configuration,
  }: {
    configuration: { url: string };
  }) => <p data-testid="scalar-url">{configuration.url}</p>,
}));

function renderDocs() {
  const services = {
    apiClient: {
      get: vi.fn(async () => []),
      put: vi.fn(),
      post: vi.fn(),
      delete: vi.fn(),
      request: vi.fn(),
    },
  } as unknown as AppServices;
  render(
    <MemoryRouter initialEntries={["/savia-request/docs"]}>
      <AppServicesProvider services={services}>
        <SaviaRequestProvider>
          <SaviaRequestDocs />
        </SaviaRequestProvider>
      </AppServicesProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("SaviaRequestDocs", () => {
  it("loads the reference in the caller's tenant scope", async () => {
    renderDocs();
    expect(await screen.findByTestId("scalar-url")).toHaveTextContent(
      "/v1/savia-request/api/openapi.json?tenant=agency%3A101",
    );
  });
});
