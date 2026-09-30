import { AppLocaleProvider } from "@/i18n/app-locale-provider";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { StoreContextProvider, memoryStore } from "ra-core";
import { afterEach, expect, it, vi } from "vitest";
import { TenantSocialSettingsPanel } from "./tenant-social-settings-panel";

afterEach(cleanup);

function renderPanel(apiClient: Record<string, ReturnType<typeof vi.fn>>) {
  render(
    <StoreContextProvider value={memoryStore({ locale: "en" })}>
      <AppLocaleProvider>
        <TenantSocialSettingsPanel
          services={{ apiClient } as never}
          tenantId={42}
        />
      </AppLocaleProvider>
    </StoreContextProvider>,
  );
}

const defaults = {
  configured: false,
  googleEnabled: false,
  microsoftEnabled: false,
  microsoftTenantId: "",
  googleAvailable: true,
  microsoftAvailable: false,
  googleCallbackUrl: "https://auth.example.test/api/auth/callback/google",
  microsoftCallbackUrl: "https://auth.example.test/api/auth/callback/microsoft",
};

it("loads availability, saves enabled providers and removes saved settings", async () => {
  const apiClient = {
    get: vi.fn().mockResolvedValue({
      ...defaults,
      configured: true,
      googleEnabled: true,
    }),
    put: vi.fn().mockResolvedValue({
      ...defaults,
      configured: true,
      googleEnabled: true,
    }),
    delete: vi.fn().mockResolvedValue(undefined),
  };
  renderPanel(apiClient);
  await screen.findByText("Configured");
  expect(screen.getByText(/Google callback URL: https/)).toBeTruthy();
  expect(
    screen.getByText(
      "Microsoft credentials are not available in this deployment.",
    ),
  ).toBeTruthy();
  expect(
    screen.getByRole("checkbox", { name: "Enable Microsoft sign-in" }),
  ).toBeDisabled();
  expect(
    screen.getByRole("textbox", { name: "Microsoft Entra tenant ID" }),
  ).toBeDisabled();

  fireEvent.click(
    screen.getByRole("checkbox", { name: "Enable Google sign-in" }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Save social sign-in settings" }),
  );
  await screen.findByText("Social sign-in settings saved.");
  expect(apiClient.put).toHaveBeenCalledWith("/v1/tenants/42/social-settings", {
    googleEnabled: false,
    microsoftEnabled: false,
    microsoftTenantId: "",
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Remove social sign-in settings" }),
  );
  await screen.findByText("Social sign-in settings removed.");
  expect(apiClient.delete).toHaveBeenCalledWith(
    "/v1/tenants/42/social-settings",
  );
});

it("recovers from load errors and reports save errors", async () => {
  const apiClient = {
    get: vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(defaults),
    put: vi.fn().mockRejectedValue(new Error("invalid tenant")),
    delete: vi.fn(),
  };
  renderPanel(apiClient);
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await screen.findByText(
    "No social sign-in providers are enabled for this tenant.",
  );
  fireEvent.click(
    screen.getByRole("checkbox", { name: "Enable Google sign-in" }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Save social sign-in settings" }),
  );
  await screen.findByText(
    "Social sign-in settings could not be saved. Check the Microsoft tenant ID and retry.",
  );
  expect(apiClient.put).toHaveBeenCalledTimes(1);
});

it("requires a directory UUID when Microsoft sign-in is enabled", async () => {
  const apiClient = {
    get: vi.fn().mockResolvedValue({ ...defaults, microsoftAvailable: true }),
    put: vi.fn().mockResolvedValue({
      ...defaults,
      microsoftAvailable: true,
      microsoftEnabled: true,
      microsoftTenantId: "123e4567-e89b-12d3-a456-426614174000",
    }),
    delete: vi.fn(),
  };
  renderPanel(apiClient);
  await screen.findByText(
    "No social sign-in providers are enabled for this tenant.",
  );
  const tenantId = screen.getByRole("textbox", {
    name: "Microsoft Entra tenant ID",
  });
  expect(tenantId).toBeDisabled();
  fireEvent.click(
    screen.getByRole("checkbox", { name: "Enable Microsoft sign-in" }),
  );
  expect(tenantId).toBeEnabled();
  fireEvent.change(tenantId, { target: { value: "not-a-guid" } });
  fireEvent.click(
    screen.getByRole("button", { name: "Save social sign-in settings" }),
  );
  expect(apiClient.put).not.toHaveBeenCalled();
  fireEvent.change(tenantId, {
    target: { value: "123e4567-e89b-12d3-a456-426614174000" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Save social sign-in settings" }),
  );
  await screen.findByText("Social sign-in settings saved.");
  expect(apiClient.put).toHaveBeenCalledWith("/v1/tenants/42/social-settings", {
    googleEnabled: false,
    microsoftEnabled: true,
    microsoftTenantId: "123e4567-e89b-12d3-a456-426614174000",
  });
});
