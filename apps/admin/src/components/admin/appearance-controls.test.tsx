import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CoreAdminContext, memoryStore } from "ra-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { i18nProvider } from "@/lib/i18nProvider";
import { type ThemeProviderState, ThemeProviderContext } from "./theme-context";
import { AppearancePanel } from "./appearance-panel";

afterEach(cleanup);

function renderWithTheme(overrides: Partial<ThemeProviderState> = {}) {
  const value: ThemeProviderState = {
    theme: "light",
    setTheme: vi.fn(),
    colorTheme: "emerald",
    setColorTheme: vi.fn(),
    ...overrides,
  };

  render(
    <CoreAdminContext i18nProvider={i18nProvider} store={memoryStore()}>
      <ThemeProviderContext.Provider value={value}>
        <DropdownMenu>
          <DropdownMenuTrigger>Account</DropdownMenuTrigger>
          <DropdownMenuContent>
            <AppearancePanel />
          </DropdownMenuContent>
        </DropdownMenu>
      </ThemeProviderContext.Provider>
    </CoreAdminContext>,
  );

  return value;
}

async function openAppearance(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Account" }));
  await user.click(await screen.findByRole("menuitem", { name: "Apariencia" }));
}

describe("appearance controls", () => {
  it.each([
    ["light", "Modo claro", "Modo oscuro", "dark"],
    ["dark", "Modo oscuro", "Modo claro", "light"],
  ] as const)(
    "switches from %s to the other mode",
    async (current, currentLabel, nextLabel, next) => {
      const user = userEvent.setup();
      const theme = renderWithTheme({ theme: current });
      await openAppearance(user);

      expect(
        await screen.findByRole("menuitemradio", { name: currentLabel }),
      ).toHaveAttribute("aria-checked", "true");
      screen.getByRole("menuitemradio", { name: nextLabel }).focus();
      await user.keyboard("{Enter}");
      expect(theme.setTheme).toHaveBeenCalledWith(next);
    },
  );

  it("selects a named palette in the account appearance submenu", async () => {
    const user = userEvent.setup();
    const theme = renderWithTheme();
    await openAppearance(user);

    expect(
      await screen.findByRole("menuitemradio", { name: "Emerald" }),
    ).toHaveAttribute("aria-checked", "true");
    screen.getByRole("menuitemradio", { name: "Mauve" }).focus();
    await user.keyboard("{Enter}");
    expect(theme.setColorTheme).toHaveBeenCalledWith("mauve");
  });

  it("keeps appearance discoverable with its controls initially closed", async () => {
    const user = userEvent.setup();
    renderWithTheme();
    await user.click(screen.getByRole("button", { name: "Account" }));

    expect(
      await screen.findByRole("menuitem", { name: "Apariencia" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("menuitemradio", { name: "Modo claro" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("menuitemradio", { name: "Emerald" }),
    ).not.toBeInTheDocument();
  });
});
