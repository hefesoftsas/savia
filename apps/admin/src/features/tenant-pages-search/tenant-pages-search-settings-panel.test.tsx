import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { StoreContextProvider, memoryStore } from "ra-core";
import { afterEach, expect, it, vi } from "vitest";
import { AppLocaleProvider } from "@/i18n/app-locale-provider";
import { TenantPagesSearchSettingsPanel } from "./tenant-pages-search-settings-panel";

afterEach(cleanup);

function renderPanel(apiClient: Record<string, ReturnType<typeof vi.fn>>) {
  render(
    <StoreContextProvider value={memoryStore({ locale: "en" })}>
      <AppLocaleProvider>
        <TenantPagesSearchSettingsPanel
          services={{ apiClient } as never}
          tenantId={42}
        />
      </AppLocaleProvider>
    </StoreContextProvider>,
  );
}

it("revoking the platform grant sends only allowed and reflects the backend clearing enabled", async () => {
  const initial = {
    tenantId: 42,
    allowed: true,
    enabled: true,
    effectiveEnabled: true,
    canGrant: true,
  };
  const apiClient = {
    get: vi.fn().mockResolvedValue({ data: initial }),
    put: vi.fn().mockResolvedValue({
      data: {
        ...initial,
        allowed: false,
        enabled: false,
        effectiveEnabled: false,
      },
    }),
  };
  renderPanel(apiClient);

  fireEvent.click(
    await screen.findByRole("switch", { name: "Grant semantic page search" }),
  );
  expect(await screen.findByText("Settings saved.")).toBeVisible();
  expect(apiClient.put).toHaveBeenCalledWith(
    "/v1/tenants/42/pages-search-settings",
    { allowed: false },
  );
  expect(
    screen.getByRole("switch", { name: "Enable semantic page search" }),
  ).not.toBeChecked();
});

it("tenant administrators cannot grant capability and save only the enabled field", async () => {
  const settings = {
    tenantId: 42,
    allowed: true,
    enabled: false,
    effectiveEnabled: false,
    canGrant: false,
  };
  const apiClient = {
    get: vi.fn().mockResolvedValue({ data: settings }),
    put: vi.fn().mockResolvedValue({
      data: { ...settings, enabled: true, effectiveEnabled: true },
    }),
  };
  renderPanel(apiClient);

  const grantSwitch = await screen.findByRole("switch", {
    name: "Enable semantic page search",
  });
  expect(
    screen.queryByRole("switch", { name: "Grant semantic page search" }),
  ).toBeNull();
  fireEvent.click(grantSwitch);
  expect(await screen.findByText("Settings saved.")).toBeVisible();
  expect(apiClient.put).toHaveBeenCalledWith(
    "/v1/tenants/42/pages-search-settings",
    { enabled: true },
  );
});

it("keeps enable disabled until platform grants the tenant capability", async () => {
  const apiClient = {
    get: vi.fn().mockResolvedValue({
      data: {
        tenantId: 42,
        allowed: false,
        enabled: false,
        effectiveEnabled: false,
        canGrant: false,
      },
    }),
    put: vi.fn(),
  };
  renderPanel(apiClient);

  expect(
    await screen.findByRole("switch", { name: "Enable semantic page search" }),
  ).toBeDisabled();
  expect(apiClient.put).not.toHaveBeenCalled();
});
