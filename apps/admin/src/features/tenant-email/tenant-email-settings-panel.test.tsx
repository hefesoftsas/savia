import { AppLocaleProvider } from "@/i18n/app-locale-provider";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { StoreContextProvider, memoryStore } from "ra-core";
import { afterEach, expect, it, vi } from "vitest";
import { TenantEmailSettingsPanel } from "./tenant-email-settings-panel";

afterEach(cleanup);

it("loads redacted settings, retains blank passwords on save, tests delivery and removes settings", async () => {
  const apiClient = {
    get: vi.fn().mockResolvedValue({
      configured: true,
      host: "smtp.example.test",
      port: 587,
      security: "starttls",
      username: "relay",
      from: "mail@example.test",
      passwordConfigured: true,
    }),
    put: vi
      .fn()
      .mockResolvedValue({ configured: true, passwordConfigured: true }),
    post: vi.fn().mockResolvedValue({ sent: true }),
    delete: vi.fn().mockResolvedValue(undefined),
  };
  render(
    <StoreContextProvider value={memoryStore({ locale: "en" })}>
      <AppLocaleProvider>
        <TenantEmailSettingsPanel
          services={{ apiClient } as never}
          tenantId={42}
        />
      </AppLocaleProvider>
    </StoreContextProvider>,
  );
  await screen.findByText("Configured");
  fireEvent.change(screen.getByLabelText("SMTP host"), {
    target: { value: "smtp.next.test" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save email settings" }));
  await screen.findByText("Email settings saved.");
  expect(apiClient.put).toHaveBeenCalledWith(
    "/v1/tenants/42/email-settings",
    expect.objectContaining({ host: "smtp.next.test", password: "" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Send test email" }));
  await screen.findByText("Test email sent to your account email.");
  expect(apiClient.post).toHaveBeenCalledWith(
    "/v1/tenants/42/email-settings/test",
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Remove email settings" }),
  );
  await screen.findByText("Email settings removed.");
  expect(apiClient.delete).toHaveBeenCalledWith(
    "/v1/tenants/42/email-settings",
  );
});

it("retains SMTP draft fields and focus when saving fails", async () => {
  const apiClient = {
    get: vi.fn().mockResolvedValue({
      configured: true,
      host: "smtp.example.test",
      username: "relay",
      from: "mail@example.test",
    }),
    put: vi.fn().mockRejectedValue(new Error("Offline")),
  };
  render(
    <StoreContextProvider value={memoryStore({ locale: "en" })}>
      <AppLocaleProvider>
        <TenantEmailSettingsPanel
          services={{ apiClient } as never}
          tenantId={42}
        />
      </AppLocaleProvider>
    </StoreContextProvider>,
  );
  const host = await screen.findByLabelText("SMTP host");
  fireEvent.change(host, { target: { value: "smtp.draft.test" } });
  host.focus();
  fireEvent.click(screen.getByRole("button", { name: "Save email settings" }));
  await screen.findByRole("alert");
  expect(screen.getByLabelText("SMTP host")).toBe(host);
  expect(host).toHaveValue("smtp.draft.test");
  expect(host).toHaveFocus();
  expect(apiClient.put).toHaveBeenCalledTimes(1);
});
