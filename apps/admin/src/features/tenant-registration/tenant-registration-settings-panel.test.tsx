import { AppLocaleProvider } from "@/i18n/app-locale-provider";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { StoreContextProvider, memoryStore } from "ra-core";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { TenantRegistrationSettingsPanel } from "./tenant-registration-settings-panel";

afterEach(cleanup);

const defaults = {
  allowEmailRegistration: false,
  captchaMode: "inherit" as const,
  siteKey: "",
  secretConfigured: false,
  emailReady: false,
  revision: "r1",
  captchaProvider: "turnstile" as const,
  captchaReady: false,
  registrationReady: false,
  passwordAllowed: true,
};

function renderPanel(
  apiClient: Record<string, ReturnType<typeof vi.fn>>,
  tenantId = 42,
  locale: "en" | "es" = "en",
) {
  render(
    <StoreContextProvider value={memoryStore({ locale })}>
      <AppLocaleProvider>
        <MemoryRouter>
          <TenantRegistrationSettingsPanel
            services={{ apiClient } as never}
            tenantId={tenantId}
          />
        </MemoryRouter>
      </AppLocaleProvider>
    </StoreContextProvider>,
  );
}

it("explains that unsaved CAPTCHA settings can be configured while registration is off", async () => {
  const apiClient = {
    get: vi.fn().mockResolvedValue(defaults),
    put: vi.fn(),
  };
  renderPanel(apiClient);
  expect(
    await screen.findByText(
      "Save CAPTCHA credentials while registration is off, then enable it after email and CAPTCHA are ready.",
    ),
  ).toBeVisible();
});

it("blocks registration when the tenant is inactive or SSO-only", async () => {
  const apiClient = {
    get: vi.fn().mockResolvedValue({
      ...defaults,
      emailReady: true,
      captchaReady: true,
      registrationReady: false,
      passwordAllowed: false,
    }),
    put: vi.fn(),
  };
  renderPanel(apiClient);
  expect(
    await screen.findByText(
      "Password registration is unavailable because this organization is inactive or requires SSO-only sign-in.",
    ),
  ).toBeVisible();
  expect(
    screen.getByRole("switch", {
      name: "Allow registration with email and password",
    }),
  ).toBeDisabled();
});

it("loads registration off and links email readiness to tenant mail settings", async () => {
  const apiClient = {
    get: vi.fn().mockResolvedValue(defaults),
    put: vi.fn(),
  };
  renderPanel(apiClient);
  expect(
    await screen.findByText("No email delivery is configured."),
  ).toBeVisible();
  expect(
    screen.getByRole("switch", {
      name: "Allow registration with email and password",
    }),
  ).not.toBeChecked();
  expect(
    screen.getByRole("switch", {
      name: "Allow registration with email and password",
    }),
  ).toBeDisabled();
  expect(
    screen.getByRole("link", { name: "Configure email delivery" }),
  ).toHaveAttribute("href", "/service-credentials?tenantId=42&tab=email");
  expect(screen.getByText("Initial access: Viewer")).toBeVisible();
});

it("configures missing Turnstile credentials while registration stays off", async () => {
  const apiClient = {
    get: vi.fn().mockResolvedValue({
      ...defaults,
      captchaReady: false,
      siteKey: "",
    }),
    put: vi.fn().mockResolvedValue({
      ...defaults,
      captchaMode: "tenant",
      siteKey: "site-123",
      secretConfigured: true,
      captchaReady: true,
      emailReady: true,
      registrationReady: true,
    }),
  };
  renderPanel(apiClient);
  await screen.findByText("No email delivery is configured.");
  expect(
    screen.getByText(
      "Save CAPTCHA credentials while registration is off, then enable it after email and CAPTCHA are ready.",
    ),
  ).toBeVisible();
  fireEvent.change(
    screen.getByRole("combobox", { name: "CAPTCHA credentials" }),
    {
      target: { value: "tenant" },
    },
  );
  fireEvent.change(
    screen.getByRole("textbox", { name: "Turnstile site key" }),
    {
      target: { value: "site-123" },
    },
  );
  fireEvent.change(screen.getByLabelText("Replace Turnstile secret"), {
    target: { value: "secret-456" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Save registration settings" }),
  );
  await screen.findByText("Registration settings saved.");
  expect(
    screen.queryByText(
      "Save CAPTCHA credentials while registration is off, then enable it after email and CAPTCHA are ready.",
    ),
  ).toBeNull();
  expect(
    screen.getByRole("switch", {
      name: "Allow registration with email and password",
    }),
  ).toBeEnabled();
  expect(apiClient.put).toHaveBeenCalledWith(
    "/v1/tenants/42/registration-settings",
    {
      allowEmailRegistration: false,
      captchaMode: "tenant",
      siteKey: "site-123",
      secretKey: "secret-456",
    },
  );
  expect(screen.getByLabelText("Replace Turnstile secret")).toHaveValue("");
});

it("preserves a hidden secret on blank save and sends null when explicitly removed", async () => {
  const apiClient = {
    get: vi.fn().mockResolvedValue({
      ...defaults,
      captchaMode: "tenant",
      siteKey: "site-123",
      secretConfigured: true,
      emailReady: true,
      captchaReady: true,
      registrationReady: true,
    }),
    put: vi.fn().mockResolvedValue({
      ...defaults,
      captchaMode: "tenant",
      siteKey: "site-123",
      secretConfigured: true,
      emailReady: true,
      captchaReady: true,
      registrationReady: true,
    }),
  };
  renderPanel(apiClient);
  await screen.findByText("Email delivery is ready.");
  fireEvent.click(
    screen.getByRole("button", { name: "Save registration settings" }),
  );
  await screen.findByText("Registration settings saved.");
  expect(apiClient.put).toHaveBeenNthCalledWith(
    1,
    "/v1/tenants/42/registration-settings",
    {
      allowEmailRegistration: false,
      captchaMode: "tenant",
      siteKey: "site-123",
    },
  );
  fireEvent.click(screen.getByRole("button", { name: "Remove saved secret" }));
  fireEvent.click(
    screen.getByRole("button", { name: "Save registration settings" }),
  );
  await screen.findByText("Registration settings saved.");
  expect(apiClient.put).toHaveBeenNthCalledWith(
    2,
    "/v1/tenants/42/registration-settings",
    {
      allowEmailRegistration: false,
      captchaMode: "tenant",
      siteKey: "site-123",
      secretKey: null,
    },
  );
});

it("uses server-managed ALTCHA without exposing a secret field", async () => {
  const apiClient = {
    get: vi.fn().mockResolvedValue({
      ...defaults,
      captchaProvider: "altcha",
      emailReady: true,
      captchaReady: true,
      registrationReady: true,
    }),
    put: vi.fn().mockResolvedValue({
      ...defaults,
      allowEmailRegistration: true,
      captchaProvider: "altcha",
      emailReady: true,
      captchaReady: true,
      registrationReady: true,
    }),
  };
  renderPanel(apiClient);
  await screen.findByText("ALTCHA is verified locally by this server.");
  expect(screen.queryByLabelText("Replace Turnstile secret")).toBeNull();
  const enabled = screen.getByRole("switch", {
    name: "Allow registration with email and password",
  });
  expect(enabled).toBeEnabled();
  fireEvent.click(enabled);
  fireEvent.click(
    screen.getByRole("button", { name: "Save registration settings" }),
  );
  await screen.findByText("Registration settings saved.");
  expect(apiClient.put).toHaveBeenCalledWith(
    "/v1/tenants/42/registration-settings",
    { allowEmailRegistration: true, captchaMode: "inherit" },
  );
});

it("reports load and readiness validation errors without enabling registration", async () => {
  const apiClient = {
    get: vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(defaults),
    put: vi.fn().mockRejectedValue(new Error("Email delivery is not ready")),
  };
  renderPanel(apiClient);
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await screen.findByText("No email delivery is configured.");
  expect(
    screen.getByRole("switch", {
      name: "Allow registration with email and password",
    }),
  ).toBeDisabled();
});
