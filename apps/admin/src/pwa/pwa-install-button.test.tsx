import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { I18nContextProvider } from "ra-core";
import { i18nProvider } from "@/lib/i18nProvider";
import { PwaInstallButton } from "./pwa-install-button";
import { SidebarProvider } from "@/components/ui/sidebar";
import * as pwaHook from "./use-pwa-install";

describe("PwaInstallButton", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders header variant when not installed and triggers dialog if no native prompt", () => {
    vi.spyOn(pwaHook, "usePwaInstall").mockReturnValue({
      isInstallable: true,
      isInstalled: false,
      hasNativePrompt: false,
      platform: "chromium",
      isIOS: false,
      promptInstall: vi.fn(),
    });

    render(
      <I18nContextProvider value={i18nProvider}>
        <PwaInstallButton variant="header" />
      </I18nContextProvider>,
    );

    const button = screen.getByRole("button", { name: /Instalar aplicación/i });
    expect(button).toBeInTheDocument();

    fireEvent.click(button);

    // Dialog should open
    expect(screen.getByText(/Instalar Savia en tu dispositivo/i)).toBeInTheDocument();
  });

  it("calls promptInstall directly when native prompt is ready", async () => {
    const mockPrompt = vi.fn().mockResolvedValue(true);
    vi.spyOn(pwaHook, "usePwaInstall").mockReturnValue({
      isInstallable: true,
      isInstalled: false,
      hasNativePrompt: true,
      platform: "chromium",
      isIOS: false,
      promptInstall: mockPrompt,
    });

    render(
      <I18nContextProvider value={i18nProvider}>
        <SidebarProvider>
          <PwaInstallButton variant="sidebar" />
        </SidebarProvider>
      </I18nContextProvider>,
    );

    const button = screen.getByRole("button", { name: /Instalar aplicación/i });
    expect(button).toBeInTheDocument();

    fireEvent.click(button);
    expect(mockPrompt).toHaveBeenCalledTimes(1);
  });

  it("renders nothing if the app is already installed", () => {
    vi.spyOn(pwaHook, "usePwaInstall").mockReturnValue({
      isInstallable: false,
      isInstalled: true,
      hasNativePrompt: false,
      platform: "chromium",
      isIOS: false,
      promptInstall: vi.fn(),
    });

    const { container } = render(
      <I18nContextProvider value={i18nProvider}>
        <PwaInstallButton variant="header" />
      </I18nContextProvider>,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
