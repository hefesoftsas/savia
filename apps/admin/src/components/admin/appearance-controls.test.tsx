import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CoreAdminContext, memoryStore } from "ra-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SidebarProvider } from "@/components/ui/sidebar";
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
      <SidebarProvider>
        <ThemeProviderContext.Provider value={value}>
          <AppearancePanel />
        </ThemeProviderContext.Provider>
      </SidebarProvider>
    </CoreAdminContext>,
  );

  return value;
}

describe("appearance controls", () => {
  it("switches directly from light to dark mode", async () => {
    const user = userEvent.setup();
    const theme = renderWithTheme();

    expect(screen.getByText("Modo claro")).toBeVisible();

    const switchControl = screen.getByRole("switch", {
      name: "Activar modo oscuro",
    });
    expect(switchControl).toHaveAttribute("aria-checked", "false");

    await user.click(switchControl);

    expect(theme.setTheme).toHaveBeenCalledWith("dark");
  });

  it("selects a palette from color-only choices", async () => {
    const user = userEvent.setup();
    const theme = renderWithTheme();

    expect(screen.getByText("Apariencia")).toBeVisible();
    expect(screen.getByText("Paleta")).toBeVisible();

    await user.click(
      screen.getByRole("button", {
        name: "Cambiar paleta de color: Emerald",
      }),
    );
    await user.click(
      await screen.findByRole("menuitemradio", { name: "Mauve" }),
    );

    expect(theme.setColorTheme).toHaveBeenCalledWith("mauve");
  });

  it("collapses the appearance controls behind the section header", async () => {
    const user = userEvent.setup();
    renderWithTheme();

    expect(screen.getByText("Paleta")).toBeVisible();
    expect(screen.getByText("Modo claro")).toBeVisible();

    await user.click(
      screen.getByRole("button", { name: "Ocultar apariencia" }),
    );

    expect(screen.queryByText("Paleta")).not.toBeInTheDocument();
    expect(screen.queryByText("Modo claro")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Mostrar apariencia" }),
    ).toBeVisible();
  });
});
