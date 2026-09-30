import { AppLocaleProvider } from "@/i18n/app-locale-provider";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { StoreContextProvider, memoryStore } from "ra-core";
import { afterEach, expect, it, vi } from "vitest";
import { TenantSSOSettingsPanel } from "./tenant-sso-settings-panel";

afterEach(cleanup);

function renderPanel(apiClient: Record<string, ReturnType<typeof vi.fn>>) {
  render(
    <StoreContextProvider value={memoryStore({ locale: "en" })}>
      <AppLocaleProvider>
        <TenantSSOSettingsPanel
          services={{ apiClient } as never}
          tenantId={42}
        />
      </AppLocaleProvider>
    </StoreContextProvider>,
  );
}

it("loads public IdP metadata, saves updates and removes the provider", async () => {
  const apiClient = {
    get: vi.fn().mockResolvedValue({
      configured: true,
      displayName: "Corporate login",
      domain: "company.example",
      idpMetadata: "<EntityDescriptor>current metadata</EntityDescriptor>",
      enabled: true,
      ssoOnly: false,
      providerId: "tenant-42-stable-id",
      entityId: "https://auth.example.test/saml/tenant-42",
      acsUrl: "https://auth.example.test/saml/tenant-42/acs",
      metadataUrl: "https://auth.example.test/saml/tenant-42/metadata",
    }),
    put: vi.fn().mockResolvedValue({
      configured: true,
      displayName: "Corporate login",
      domain: "company.example",
      idpMetadata: "<EntityDescriptor>updated metadata</EntityDescriptor>",
      enabled: true,
      ssoOnly: true,
      providerId: "tenant-42-stable-id",
      entityId: "https://auth.example.test/saml/tenant-42",
      acsUrl: "https://auth.example.test/saml/tenant-42/acs",
      metadataUrl: "https://auth.example.test/saml/tenant-42/metadata",
    }),
    delete: vi.fn().mockResolvedValue(undefined),
  };
  renderPanel(apiClient);
  await screen.findByText("Configured");
  expect(
    screen.getByText("https://auth.example.test/saml/tenant-42"),
  ).toBeTruthy();
  expect(
    screen.getByRole("textbox", { name: /Identity provider metadata XML/ }),
  ).toHaveValue("<EntityDescriptor>current metadata</EntityDescriptor>");
  fireEvent.change(screen.getByLabelText("Provider name"), {
    target: { value: "Corporate login" },
  });
  fireEvent.change(
    screen.getByRole("textbox", { name: /Identity provider metadata XML/ }),
    {
      target: {
        value: "<EntityDescriptor>updated metadata</EntityDescriptor>",
      },
    },
  );
  fireEvent.click(screen.getByRole("checkbox", { name: "SSO-only sign-in" }));
  fireEvent.click(screen.getByRole("button", { name: "Save SSO settings" }));
  await screen.findByText("SSO settings saved.");
  expect(apiClient.put).toHaveBeenCalledWith(
    "/v1/tenants/42/sso-settings",
    expect.objectContaining({
      displayName: "Corporate login",
      domain: "company.example",
      idpMetadata: "<EntityDescriptor>updated metadata</EntityDescriptor>",
      enabled: true,
      ssoOnly: true,
    }),
  );
  expect(
    screen.getByRole("textbox", { name: /Identity provider metadata XML/ }),
  ).toHaveValue("<EntityDescriptor>updated metadata</EntityDescriptor>");
  fireEvent.click(screen.getByRole("button", { name: "Remove SSO settings" }));
  await screen.findByText("SSO settings removed.");
  expect(apiClient.delete).toHaveBeenCalledWith("/v1/tenants/42/sso-settings");
});

it("shows a retry action for read failures and a recoverable save error", async () => {
  const apiClient = {
    get: vi
      .fn()
      .mockRejectedValueOnce(new Error("unavailable"))
      .mockResolvedValueOnce({ configured: false }),
    put: vi.fn().mockRejectedValue(new Error("invalid provider")),
    delete: vi.fn(),
  };
  renderPanel(apiClient);
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await screen.findByText("No SAML provider is configured for this tenant.");
  fireEvent.change(screen.getByLabelText("Provider name"), {
    target: { value: "Corporate login" },
  });
  fireEvent.change(screen.getByRole("textbox", { name: /Email domain/ }), {
    target: { value: "company.example" },
  });
  fireEvent.change(
    screen.getByRole("textbox", { name: /Identity provider metadata XML/ }),
    {
      target: { value: "<EntityDescriptor/>" },
    },
  );
  fireEvent.click(screen.getByRole("button", { name: "Save SSO settings" }));
  await screen.findByText(
    "SSO settings could not be saved. Check the provider metadata and retry.",
  );
  await waitFor(() => expect(apiClient.put).toHaveBeenCalledTimes(1));
});
