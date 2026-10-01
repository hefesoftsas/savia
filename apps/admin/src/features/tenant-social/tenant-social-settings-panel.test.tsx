import { AppLocaleProvider } from "@/i18n/app-locale-provider";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { StoreContextProvider, memoryStore } from "ra-core";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { TenantSocialSettingsPanel } from "./tenant-social-settings-panel";

afterEach(cleanup);

function renderPanel(
  apiClient: Record<string, ReturnType<typeof vi.fn>>,
  locale: "en" | "es" = "en",
  tenantId = 42,
) {
  return render(
    <StoreContextProvider value={memoryStore({ locale })}>
      <AppLocaleProvider>
        <MemoryRouter>
          <TenantSocialSettingsPanel
            services={{ apiClient } as never}
            tenantId={tenantId}
          />
        </MemoryRouter>
      </AppLocaleProvider>
    </StoreContextProvider>,
  );
}

const defaults = {
  configured: false,
  googleEnabled: false,
  microsoftEnabled: false,
  allowMicrosoftPersonalAccounts: false,
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
  expect(
    screen.getByRole("switch", {
      name: "Create new users through federated sign-in",
    }),
  ).not.toBeChecked();
  expect(
    screen.getByRole("switch", {
      name: "Allow personal Microsoft accounts",
    }),
  ).not.toBeChecked();
  expect(
    screen.getByText("Initial access: Viewer", { selector: "strong" }),
  ).toBeTruthy();
  expect(
    screen.getByText(
      "When disabled, an administrator must create users before they can sign in. When enabled, anyone with a provider-verified email from an enabled provider can join, subject to this tenant's user limit.",
    ),
  ).toBeTruthy();

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
    allowRegistration: false,
    allowMicrosoftPersonalAccounts: false,
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
    allowRegistration: false,
    allowMicrosoftPersonalAccounts: false,
  });
});

it("saves federated registration as enabled for verified users", async () => {
  const apiClient = {
    get: vi.fn().mockResolvedValue(defaults),
    put: vi.fn().mockResolvedValue({
      ...defaults,
      configured: true,
      allowRegistration: true,
    }),
    delete: vi.fn().mockResolvedValue(undefined),
  };
  renderPanel(apiClient);
  const registration = await screen.findByRole("switch", {
    name: "Create new users through federated sign-in",
  });
  fireEvent.click(registration);
  expect(registration).toBeChecked();
  fireEvent.click(
    screen.getByRole("button", { name: "Save social sign-in settings" }),
  );
  await screen.findByText("Social sign-in settings saved.");
  expect(apiClient.put).toHaveBeenCalledWith("/v1/tenants/42/social-settings", {
    googleEnabled: false,
    microsoftEnabled: false,
    microsoftTenantId: "",
    allowRegistration: true,
    allowMicrosoftPersonalAccounts: false,
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Remove social sign-in settings" }),
  );
  await screen.findByText("Social sign-in settings removed.");
  expect(
    screen.getByRole("switch", {
      name: "Create new users through federated sign-in",
    }),
  ).not.toBeChecked();
});

it("shows the Spanish registration label and keeps legacy settings disabled", async () => {
  const apiClient = {
    get: vi.fn().mockResolvedValue(defaults),
    put: vi.fn(),
    delete: vi.fn(),
  };
  renderPanel(apiClient, "es");
  expect(
    await screen.findByRole("switch", {
      name: "Crear nuevos usuarios mediante login federado",
    }),
  ).not.toBeChecked();
  expect(
    screen.getByText("Acceso inicial: Viewer", { selector: "strong" }),
  ).toBeTruthy();
  expect(
    screen.getByRole("switch", {
      name: "Permitir cuentas personales de Microsoft",
    }),
  ).not.toBeChecked();
});

it("loads and saves the Microsoft personal account option independently", async () => {
  const apiClient = {
    get: vi.fn().mockResolvedValue({
      ...defaults,
      microsoftAvailable: true,
      microsoftEnabled: true,
      microsoftTenantId: "123e4567-e89b-12d3-a456-426614174000",
      allowMicrosoftPersonalAccounts: true,
      emailReady: false,
    }),
    put: vi.fn().mockResolvedValue({
      ...defaults,
      microsoftAvailable: true,
      microsoftEnabled: true,
      microsoftTenantId: "123e4567-e89b-12d3-a456-426614174000",
      allowMicrosoftPersonalAccounts: true,
      emailReady: false,
    }),
    delete: vi.fn(),
  };
  renderPanel(apiClient);
  const personalAccounts = await screen.findByRole("switch", {
    name: "Allow personal Microsoft accounts",
  });
  expect(personalAccounts).toBeChecked();
  expect(personalAccounts).toBeEnabled();
  expect(
    await screen.findByText(
      "First-time personal Microsoft sign-in requires Savia email verification. Existing verified Microsoft accounts can continue signing in.",
    ),
  ).toBeVisible();
  expect(
    screen.getByRole("link", { name: "Configure email delivery" }),
  ).toHaveAttribute("href", "/service-credentials?tenantId=42&tab=email");
  fireEvent.click(
    screen.getByRole("button", { name: "Save social sign-in settings" }),
  );
  await screen.findByText("Social sign-in settings saved.");
  expect(apiClient.put).toHaveBeenCalledWith("/v1/tenants/42/social-settings", {
    googleEnabled: false,
    microsoftEnabled: true,
    microsoftTenantId: "123e4567-e89b-12d3-a456-426614174000",
    allowRegistration: false,
    allowMicrosoftPersonalAccounts: true,
  });
});

it("localizes the first personal Microsoft verification notice", async () => {
  const apiClient = {
    get: vi.fn().mockResolvedValue({
      ...defaults,
      microsoftAvailable: true,
      microsoftEnabled: true,
      microsoftTenantId: "123e4567-e89b-12d3-a456-426614174000",
      allowMicrosoftPersonalAccounts: true,
      emailReady: false,
    }),
    put: vi.fn(),
    delete: vi.fn(),
  };
  renderPanel(apiClient, "es");
  expect(
    await screen.findByText(
      "El primer inicio de sesión con una cuenta personal de Microsoft requiere la verificación de correo de Savia. Las cuentas de Microsoft ya verificadas pueden seguir iniciando sesión.",
    ),
  ).toBeVisible();
  expect(
    screen.getByRole("link", { name: "Configurar entrega de correo" }),
  ).toHaveAttribute("href", "/service-credentials?tenantId=42&tab=email");
});

it("omits the email prerequisite notice when email delivery is ready", async () => {
  const apiClient = {
    get: vi.fn().mockResolvedValue({
      ...defaults,
      microsoftAvailable: true,
      microsoftEnabled: true,
      microsoftTenantId: "123e4567-e89b-12d3-a456-426614174000",
      allowMicrosoftPersonalAccounts: true,
      emailReady: true,
    }),
    put: vi.fn(),
    delete: vi.fn(),
  };
  renderPanel(apiClient);
  const personalAccounts = await screen.findByRole("switch", {
    name: "Allow personal Microsoft accounts",
  });
  expect(personalAccounts).toBeChecked();
  expect(personalAccounts).toBeEnabled();
  expect(
    screen.queryByText(
      "First-time personal Microsoft sign-in requires Savia email verification. Existing verified Microsoft accounts can continue signing in.",
    ),
  ).toBeNull();
});

it("defaults ChatGPT sign-in off and keeps it disabled when unavailable", async () => {
  const apiClient = {
    get: vi.fn().mockResolvedValue({
      ...defaults,
      chatgptEnabled: false,
      chatgptAvailable: false,
      chatgptCallbackUrl: "",
    }),
    put: vi.fn(),
    delete: vi.fn(),
  };
  renderPanel(apiClient);

  const chatgpt = await screen.findByRole("checkbox", {
    name: "Enable ChatGPT sign-in",
  });
  expect(chatgpt).not.toBeChecked();
  expect(chatgpt).toBeDisabled();
});

it("saves ChatGPT sign-in and exposes its callback and email prerequisite", async () => {
  const callbackUrl = "https://auth.example.test/api/auth/callback/chatgpt";
  const apiClient = {
    get: vi.fn().mockResolvedValue({
      ...defaults,
      chatgptEnabled: false,
      chatgptAvailable: true,
      chatgptCallbackUrl: callbackUrl,
      emailReady: false,
    }),
    put: vi.fn().mockResolvedValue({
      ...defaults,
      chatgptEnabled: true,
      chatgptAvailable: true,
      chatgptCallbackUrl: callbackUrl,
      emailReady: false,
    }),
    delete: vi.fn(),
  };
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  renderPanel(apiClient);

  const callback = await screen.findByRole("textbox", {
    name: "ChatGPT callback URL",
  });
  expect(callback).toHaveValue(callbackUrl);
  expect(callback).toHaveAttribute("readonly");
  fireEvent.click(
    screen.getByRole("checkbox", { name: "Enable ChatGPT sign-in" }),
  );
  expect(
    screen.getByRole("link", { name: "Configure email delivery" }),
  ).toHaveAttribute("href", "/service-credentials?tenantId=42&tab=email");

  fireEvent.click(
    screen.getByRole("button", { name: "Copy ChatGPT callback URL" }),
  );
  expect(writeText).toHaveBeenCalledWith(callbackUrl);
  fireEvent.click(
    screen.getByRole("button", { name: "Save social sign-in settings" }),
  );
  await screen.findByText("Social sign-in settings saved.");
  expect(apiClient.put).toHaveBeenCalledWith("/v1/tenants/42/social-settings", {
    googleEnabled: false,
    microsoftEnabled: false,
    microsoftTenantId: "",
    allowRegistration: false,
    allowMicrosoftPersonalAccounts: false,
    chatgptEnabled: true,
  });
});

it("resets ChatGPT enablement when the selected tenant changes", async () => {
  const apiClient = {
    get: vi.fn((path: string) =>
      Promise.resolve({
        ...defaults,
        chatgptEnabled: path.includes("/42/"),
        chatgptAvailable: true,
        chatgptCallbackUrl:
          "https://auth.example.test/api/auth/callback/chatgpt",
      }),
    ),
    put: vi.fn(),
    delete: vi.fn(),
  };
  const view = renderPanel(apiClient);
  expect(
    await screen.findByRole("checkbox", { name: "Enable ChatGPT sign-in" }),
  ).toBeChecked();

  view.rerender(
    <StoreContextProvider value={memoryStore({ locale: "en" })}>
      <AppLocaleProvider>
        <MemoryRouter>
          <TenantSocialSettingsPanel
            services={{ apiClient } as never}
            tenantId={43}
          />
        </MemoryRouter>
      </AppLocaleProvider>
    </StoreContextProvider>,
  );

  expect(
    await screen.findByRole("checkbox", { name: "Enable ChatGPT sign-in" }),
  ).not.toBeChecked();
});
