import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { AppServices } from "@/app-services";
import { AppServicesProvider } from "@/features/assistant/assistant-context";
import { ThemeProviderContext, type ThemeProviderState } from "./theme-context";
import { AppearancePreferencesSync } from "./appearance-preferences-sync";

afterEach(cleanup);

it("avoids repeating appearance hydration for a services wrapper change", async () => {
  const preferences = {
    getAppearance: vi
      .fn()
      .mockResolvedValue({ version: 1, theme: "light", colorTheme: "emerald" }),
    saveAppearance: vi.fn(),
  };
  const services = { userPreferences: preferences } as unknown as AppServices;
  const theme = {
    theme: "light",
    colorTheme: "emerald",
    setTheme: vi.fn(),
    setColorTheme: vi.fn(),
  } as ThemeProviderState;
  const tree = (value: AppServices) => (
    <AppServicesProvider services={value}>
      <ThemeProviderContext.Provider value={theme}>
        <AppearancePreferencesSync />
      </ThemeProviderContext.Provider>
    </AppServicesProvider>
  );
  const view = render(tree(services));
  await waitFor(() =>
    expect(preferences.getAppearance).toHaveBeenCalledTimes(1),
  );
  view.rerender(tree({ ...services }));
  expect(preferences.getAppearance).toHaveBeenCalledTimes(1);
});

it("does not reapply unchanged preferences on account hints", async () => {
  const preferences = {
    getAppearance: vi
      .fn()
      .mockResolvedValue({ version: 1, theme: "light", colorTheme: "emerald" }),
    saveAppearance: vi.fn(),
  };
  const services = { userPreferences: preferences } as unknown as AppServices;
  const theme = {
    theme: "light",
    colorTheme: "emerald",
    setTheme: vi.fn(),
    setColorTheme: vi.fn(),
  } as ThemeProviderState;
  render(
    <AppServicesProvider services={services}>
      <ThemeProviderContext.Provider value={theme}>
        <AppearancePreferencesSync />
      </ThemeProviderContext.Provider>
    </AppServicesProvider>,
  );
  await act(async () => {});
  vi.mocked(theme.setTheme).mockClear();
  vi.mocked(theme.setColorTheme).mockClear();
  await act(async () =>
    window.dispatchEvent(new Event("savia:account-changed")),
  );
  expect(preferences.getAppearance).toHaveBeenCalledTimes(2);
  expect(theme.setTheme).not.toHaveBeenCalled();
  expect(theme.setColorTheme).not.toHaveBeenCalled();
  expect(preferences.saveAppearance).not.toHaveBeenCalled();
});
