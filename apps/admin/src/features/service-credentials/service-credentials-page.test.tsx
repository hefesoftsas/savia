import { render } from "@/features/studio-engine/test/locale-test-render";
import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppServices } from "@/app-services";
import { ServiceCredentialsPage } from "./service-credentials-page";

const permissionState = vi.hoisted(() => ({
  permissions: { canManageIdentity: true } as
    { canManageIdentity: boolean } | undefined,
  isPending: false,
}));

vi.mock("ra-core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ra-core")>()),
  usePermissions: () => permissionState,
}));

beforeEach(() => {
  permissionState.permissions = { canManageIdentity: true };
  permissionState.isPending = false;
});

vi.mock("./studio-tenant-credentials-section", () => ({
  StudioTenantCredentialsSection: ({
    globalCredentials,
  }: {
    globalCredentials?: React.ReactNode;
  }) => (
    <section aria-label="CRM credentials mock">{globalCredentials}</section>
  ),
}));

afterEach(cleanup);

function servicesWithSummary() {
  return {
    assistantConfiguration: {
      summary: vi.fn().mockResolvedValue({
        global: {
          scope: "global",
          keyState: "configured",
          model: "deepseek/deepseek-v4-flash",
          updatedAt: "2026-09-03T12:00:00.000Z",
          updatedBy: "platform-admin",
        },
        tenants: [],
      }),
      models: vi.fn().mockResolvedValue([]),
      activeTenant: vi.fn().mockResolvedValue({
        tenants: [{ tenantId: 101, label: "Tenant Norte" }],
      }),
      saveGlobal: vi.fn(),
      saveTenantOverride: vi.fn(),
      clearTenantOverride: vi.fn(),
    },
  } as unknown as AppServices;
}

describe("ServiceCredentialsPage", () => {
  it.each(["tenant", "pending"])(
    "does not fetch platform credentials for %s permissions",
    (state) => {
      permissionState.permissions =
        state === "tenant" ? { canManageIdentity: false } : undefined;
      permissionState.isPending = state === "pending";
      const services = servicesWithSummary();
      render(<ServiceCredentialsPage services={services} />);

      expect(
        screen.getByRole("heading", { name: "Claves y servicios" }),
      ).toBeVisible();
      expect(services.assistantConfiguration.summary).not.toHaveBeenCalled();
      expect(screen.queryByText("OpenRouter")).not.toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    },
  );

  it("shows global AI credentials inside the unified credentials screen", async () => {
    render(<ServiceCredentialsPage services={servicesWithSummary()} />);

    expect(
      await screen.findByRole("heading", { name: "Claves y servicios" }),
    ).toBeVisible();
    expect(
      within(
        screen
          .getByRole("heading", { name: "Claves y servicios" })
          .closest("header")!,
      ).getByRole("button", {
        name: "Ayuda sobre credenciales",
      }),
    ).toBeVisible();
    expect(screen.getByRole("heading", { name: "OpenRouter" })).toBeVisible();
    expect(screen.getByLabelText("Clave OpenRouter")).toBeVisible();
    expect(
      screen.queryByRole("tab", { name: /Por (organización|agencia)/i }),
    ).toBeNull();
  });
});
