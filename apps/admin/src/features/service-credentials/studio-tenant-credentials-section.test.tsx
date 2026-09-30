import { cleanup, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "@/features/studio-engine/test/locale-test-render";
import type { TenantWorkspace } from "@/api/tenant-workspaces-client";
import type { AppServices } from "@/app-services";
import { StudioTenantCredentialsSection } from "./studio-tenant-credentials-section";

const testState = vi.hoisted(() => ({
  workspaces: [] as Array<{
    id: string;
    tenantId: number;
    label: string;
    kind: "platform" | "tenant";
    apiBasePath: string;
  }>,
}));

vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQuery: ({ queryKey }: { queryKey: string[] }) =>
    queryKey[0] === "integrations"
      ? { data: { data: [] }, isLoading: false, error: null }
      : {
          data: { geoapifyConfigured: false, geoapifyStored: false },
          isLoading: false,
          error: null,
        },
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  useNavigate: () => vi.fn(),
}));

vi.mock("@/features/studio/studio-tenants", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/studio/studio-tenants")>()),
  listStudioTenants: async () => testState.workspaces,
}));

vi.mock("@/api/embedded-transport", () => ({
  createEmbeddedTransport: () => ({}),
}));

vi.mock("@/features/studio-engine/runtime", () => ({
  setStudioRuntime: vi.fn(),
}));

vi.mock("@/features/studio-engine/geocoding-settings-panel", () => ({
  GeocodingSettingsPanel: () => null,
}));

vi.mock("@/features/tenant-sso/tenant-sso-settings-panel", () => ({
  TenantSSOSettingsPanel: () => <div>Tenant SAML settings</div>,
}));

vi.mock("@/features/tenant-social/tenant-social-settings-panel", () => ({
  TenantSocialSettingsPanel: () => <div>Google / Microsoft settings</div>,
}));

vi.mock("@/features/tenant-email/tenant-email-settings-panel", () => ({
  TenantEmailSettingsPanel: () => <div>Tenant email settings</div>,
}));

afterEach(cleanup);

const services = { apiClient: { get: vi.fn() } } as unknown as AppServices;

function workspace(tenantId: number): TenantWorkspace {
  return {
    id: String(tenantId),
    tenantId,
    label: tenantId === 0 ? "Platform" : "Tenant Norte",
    kind: tenantId === 0 ? "platform" : "tenant",
    apiBasePath: `/v1/tenants/${tenantId}`,
  };
}

describe("StudioTenantCredentialsSection identity providers", () => {
  it("hides SAML and social sign-in settings in the platform workspace", async () => {
    testState.workspaces = [workspace(0)];
    render(<StudioTenantCredentialsSection services={services} />);

    await waitFor(() =>
      expect(
        screen.getByRole("tab", { name: "Correo del tenant" }),
      ).toBeEnabled(),
    );
    expect(screen.queryByRole("tab", { name: "Inicio de sesión SAML" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "Google / Microsoft" })).toBeNull();
  });

  it("keeps SAML and social sign-in settings available for tenant workspaces", async () => {
    testState.workspaces = [workspace(101)];
    render(<StudioTenantCredentialsSection services={services} />);

    await waitFor(() =>
      expect(
        screen.getByRole("tab", { name: "Inicio de sesión SAML" }),
      ).toBeEnabled(),
    );
    expect(screen.getByRole("tab", { name: "Google / Microsoft" })).toBeVisible();
  });
});
