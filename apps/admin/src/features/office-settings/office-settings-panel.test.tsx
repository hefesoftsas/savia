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
import { OfficeSettingsPanel } from "./office-settings-panel";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const settings = (tenantId: number, overrides = {}) => ({
  data: {
    tenantId,
    platformAllowed: true,
    tenantEnabled: false,
    enabled: false,
    canManagePlatform: true,
    canManageTenant: true,
    ...overrides,
  },
});

function renderPanel(
  apiClient: Record<string, ReturnType<typeof vi.fn>>,
  tenantId = 42,
) {
  return render(
    <StoreContextProvider value={memoryStore({ locale: "en" })}>
      <AppLocaleProvider>
        <OfficeSettingsPanel
          services={{ apiClient } as never}
          tenantId={tenantId}
        />
      </AppLocaleProvider>
    </StoreContextProvider>,
  );
}

it("loads server state and patches only the changed tenant setting", async () => {
  const dispatch = vi.spyOn(window, "dispatchEvent");
  const apiClient = {
    get: vi.fn().mockResolvedValue(settings(42, { tenantEnabled: false })),
    patch: vi
      .fn()
      .mockResolvedValue(settings(42, { tenantEnabled: true, enabled: true })),
  };
  renderPanel(apiClient);
  const tenantSwitch = await screen.findByRole("switch", {
    name: "Enable office suite for this tenant",
  });
  expect(tenantSwitch).not.toBeChecked();
  fireEvent.click(tenantSwitch);
  await waitFor(() =>
    expect(apiClient.patch).toHaveBeenCalledWith(
      "/v1/tenants/42/office-settings",
      { tenantEnabled: true },
    ),
  );
  await waitFor(() => expect(tenantSwitch).toBeChecked());
  expect(dispatch).toHaveBeenCalledWith(
    expect.objectContaining({ type: "savia:office-settings-changed" }),
  );
  expect(apiClient.patch).toHaveBeenCalledTimes(1);
  expect(apiClient.get).toHaveBeenCalledWith("/v1/tenants/42/office-settings");
});

it("restricts platform patches to platform administrators", async () => {
  const apiClient = {
    get: vi.fn().mockResolvedValue(settings(42)),
    patch: vi.fn().mockResolvedValue(settings(42, { platformAllowed: false })),
  };
  renderPanel(apiClient);
  const platformSwitch = await screen.findByRole("switch", {
    name: "Allow office suite for this tenant",
  });
  fireEvent.click(platformSwitch);
  await waitFor(() =>
    expect(apiClient.patch).toHaveBeenCalledWith(
      "/v1/tenants/42/office-settings",
      { platformAllowed: false },
    ),
  );
  expect(
    await screen.findByText(
      "Office suite is disabled by the platform administrator.",
    ),
  ).toBeTruthy();
  expect(
    screen.getByRole("switch", {
      name: "Enable office suite for this tenant",
    }),
  ).toBeDisabled();
});

it("keeps a switch pessimistic while a setting patch is pending", async () => {
  let resolvePatch!: (value: unknown) => void;
  const apiClient = {
    get: vi.fn().mockResolvedValue(settings(42)),
    patch: vi.fn(
      () =>
        new Promise((resolve) => {
          resolvePatch = resolve;
        }),
    ),
  };
  renderPanel(apiClient);
  const toggle = await screen.findByRole("switch", {
    name: "Enable office suite for this tenant",
  });
  fireEvent.click(toggle);
  expect(toggle).not.toBeChecked();
  expect(toggle).toBeDisabled();
  resolvePatch(settings(42, { tenantEnabled: true, enabled: true }));
  await waitFor(() => expect(toggle).toBeChecked());
  expect(toggle).toBeEnabled();
});

it("shows platform blocking and limits switches to granted permissions", async () => {
  const apiClient = {
    get: vi.fn().mockResolvedValue(
      settings(42, {
        platformAllowed: false,
        canManagePlatform: false,
        canManageTenant: true,
      }),
    ),
    patch: vi.fn(),
  };
  renderPanel(apiClient);
  expect(
    await screen.findByText(
      "Office suite is disabled by the platform administrator.",
    ),
  ).toBeTruthy();
  expect(
    screen.queryByRole("switch", {
      name: "Allow office suite for this tenant",
    }),
  ).toBeNull();
  const tenantSwitch = screen.getByRole("switch", {
    name: "Enable office suite for this tenant",
  });
  expect(tenantSwitch).toBeDisabled();
  expect(
    screen.getByText(
      "Existing documents are preserved when access is disabled.",
    ),
  ).toBeTruthy();
});

it("handles a synchronous GET failure and can retry", async () => {
  const apiClient = {
    get: vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error("offline");
      })
      .mockResolvedValueOnce(settings(42)),
    patch: vi.fn(),
  };
  renderPanel(apiClient);
  expect(await screen.findByRole("alert")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(
    await screen.findByRole("switch", {
      name: "Enable office suite for this tenant",
    }),
  ).toBeEnabled();
});

it("keeps the server value after a failed save and releases the busy state", async () => {
  const apiClient = {
    get: vi.fn().mockResolvedValue(settings(42)),
    patch: vi.fn().mockRejectedValue(new Error("offline")),
  };
  renderPanel(apiClient);
  const toggle = await screen.findByRole("switch", {
    name: "Enable office suite for this tenant",
  });
  fireEvent.click(toggle);
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(toggle).not.toBeChecked();
  expect(toggle).toBeEnabled();
  fireEvent.click(toggle);
  await waitFor(() => expect(apiClient.patch).toHaveBeenCalledTimes(2));
});

it("ignores a late response from a previous tenant scope", async () => {
  let resolveOld!: (value: unknown) => void;
  const apiClient = {
    get: vi.fn((path: string) =>
      path.includes("/42/")
        ? new Promise((resolve) => {
            resolveOld = resolve;
          })
        : Promise.resolve(
            settings(43, { platformAllowed: false, canManagePlatform: false }),
          ),
    ),
    patch: vi.fn(),
  };
  const view = renderPanel(apiClient, 42);
  view.rerender(
    <StoreContextProvider value={memoryStore({ locale: "en" })}>
      <AppLocaleProvider>
        <OfficeSettingsPanel services={{ apiClient } as never} tenantId={43} />
      </AppLocaleProvider>
    </StoreContextProvider>,
  );
  expect(
    await screen.findByText(
      "Office suite is disabled by the platform administrator.",
    ),
  ).toBeTruthy();
  resolveOld(settings(42, { platformAllowed: true, tenantEnabled: true }));
  await waitFor(() =>
    expect(
      screen.queryByRole("switch", {
        name: "Allow office suite for this tenant",
      }),
    ).toBeNull(),
  );
  expect(
    screen.getByRole("switch", { name: "Enable office suite for this tenant" }),
  ).toBeDisabled();
});
