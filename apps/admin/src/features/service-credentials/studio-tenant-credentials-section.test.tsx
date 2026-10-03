import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { Link, MemoryRouter } from "react-router-dom";
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
  ...(await importOriginal<
    typeof import("@/features/studio/studio-tenants")
  >()),
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
  TenantSocialSettingsPanel: () => <div>Social sign-in settings</div>,
}));

vi.mock("@/features/office-settings/office-settings-panel", () => ({
  OfficeSettingsPanel: ({ tenantId }: { tenantId: number }) => (
    <div>Office settings for tenant {tenantId}</div>
  ),
}));

vi.mock("@/features/tenant-email/tenant-email-settings-panel", () => ({
  TenantEmailSettingsPanel: () => <div>Tenant email settings</div>,
}));

vi.mock(
  "@/features/tenant-registration/tenant-registration-settings-panel",
  () => ({
    TenantRegistrationSettingsPanel: ({ tenantId }: { tenantId: number }) => (
      <div>Registration settings for tenant {tenantId}</div>
    ),
  }),
);

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

function renderCredentials(path = "/service-credentials") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <StudioTenantCredentialsSection services={services} />
      <Link to="/service-credentials?tenantId=102&tab=social">
        Other tenant sign-in
      </Link>
    </MemoryRouter>,
  );
}

describe("StudioTenantCredentialsSection identity providers", () => {
  it("hides SAML and social sign-in settings in the platform workspace", async () => {
    testState.workspaces = [workspace(0)];
    renderCredentials();

    await waitFor(() =>
      expect(
        screen.getByRole("tab", { name: "Correo del tenant" }),
      ).toBeEnabled(),
    );
    expect(
      screen.queryByRole("tab", { name: "Inicio de sesión SAML" }),
    ).toBeNull();
    expect(
      screen.queryByRole("tab", { name: "Inicio de sesión social" }),
    ).toBeNull();
  });

  it("keeps SAML and social sign-in settings available for tenant workspaces", async () => {
    testState.workspaces = [workspace(101)];
    renderCredentials();

    await waitFor(() =>
      expect(
        screen.getByRole("tab", { name: "Inicio de sesión SAML" }),
      ).toBeEnabled(),
    );
    expect(
      screen.getByRole("tab", { name: "Inicio de sesión social" }),
    ).toBeVisible();
  });

  it("opens registration from its tenant-scoped deep link and follows tenant switches", async () => {
    testState.workspaces = [workspace(101), workspace(102)];
    renderCredentials("/service-credentials?tenantId=101&tab=registration");

    await waitFor(() =>
      expect(
        screen.getByRole("tab", { name: "Registro de usuarios" }),
      ).toHaveAttribute("aria-selected", "true"),
    );
    expect(screen.getByRole("tabpanel")).toHaveTextContent(
      "Registration settings for tenant 101",
    );
    fireEvent.change(
      screen.getByRole("combobox", { name: "Espacio de trabajo" }),
      {
        target: { value: "102" },
      },
    );
    await waitFor(() =>
      expect(screen.getByRole("tabpanel")).toHaveTextContent(
        "Registration settings for tenant 102",
      ),
    );
  });

  it("opens the requested tenant's SSO tab from a direct link", async () => {
    testState.workspaces = [workspace(0), workspace(101)];
    renderCredentials("/service-credentials?tenantId=101&tab=sso");

    await waitFor(() =>
      expect(
        screen.getByRole("tab", { name: "Inicio de sesión SAML" }),
      ).toHaveAttribute("aria-selected", "true"),
    );
    expect(
      screen.getByRole("combobox", { name: "Espacio de trabajo" }),
    ).toHaveValue("101");
    expect(screen.getByRole("tabpanel")).toHaveTextContent(
      "Tenant SAML settings",
    );
  });

  it("updates the tenant and sign-in tab when the route changes", async () => {
    testState.workspaces = [workspace(0), workspace(101), workspace(102)];
    renderCredentials("/service-credentials?tenantId=101&tab=sso");
    await screen.findByText("Tenant SAML settings");

    fireEvent.click(screen.getByRole("link", { name: "Other tenant sign-in" }));

    await waitFor(() =>
      expect(
        screen.getByRole("tab", { name: "Inicio de sesión social" }),
      ).toHaveAttribute("aria-selected", "true"),
    );
    expect(
      screen.getByRole("combobox", { name: "Espacio de trabajo" }),
    ).toHaveValue("102");
    expect(screen.getByRole("tabpanel")).toHaveTextContent(
      "Social sign-in settings",
    );
  });

  it.each(["999", "-1", "", "invalid"])(
    "does not substitute another tenant for an unavailable linked ID (%s)",
    async (tenantId) => {
      testState.workspaces = [workspace(101)];
      renderCredentials(`/service-credentials?tenantId=${tenantId}&tab=sso`);

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "El espacio solicitado no está disponible",
      );
      expect(
        screen.getByRole("tab", { name: "Inicio de sesión SAML" }),
      ).toBeDisabled();
      expect(screen.queryByText("Tenant SAML settings")).toBeNull();
      expect(
        screen.getByRole("tab", { name: "Inicio de sesión social" }),
      ).toBeDisabled();

      fireEvent.change(screen.getByRole("combobox"), {
        target: { value: "101" },
      });
      expect(await screen.findByText("Tenant SAML settings")).toBeVisible();
      expect(screen.queryByRole("alert")).toBeNull();
    },
  );
});

it("opens office administration for the selected tenant", async () => {
  testState.workspaces = [workspace(101), workspace(102)];
  renderCredentials("/service-credentials?tenantId=102&tab=office");
  await waitFor(() =>
    expect(
      screen.getByRole("tab", { name: "Suite de ofimática" }),
    ).toHaveAttribute("aria-selected", "true"),
  );
  expect(screen.getByRole("tabpanel")).toHaveTextContent(
    "Office settings for tenant 102",
  );
});
