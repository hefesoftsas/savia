import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { I18nContextProvider } from "ra-core";
import { i18nProvider } from "@/lib/i18nProvider";
import { PwaInstallBanner, PWA_BANNER_DISMISS_KEY } from "./pwa-install-banner";
import * as pwaHook from "./use-pwa-install";

function mockPwaState(
  overrides: Partial<ReturnType<typeof pwaHook.usePwaInstall>> = {},
) {
  vi.spyOn(pwaHook, "usePwaInstall").mockReturnValue({
    isInstallable: true,
    isInstalled: false,
    hasNativePrompt: false,
    platform: "android",
    isIOS: false,
    promptInstall: vi.fn().mockResolvedValue(false),
    ...overrides,
  });
}

describe("PwaInstallBanner", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("renders nothing when the app is already installed", () => {
    mockPwaState({ isInstallable: false, isInstalled: true });

    const { container } = render(
      <I18nContextProvider value={i18nProvider}>
        <PwaInstallBanner />
      </I18nContextProvider>,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("shows banner when not installed and opens dialog on install", () => {
    mockPwaState();

    render(
      <I18nContextProvider value={i18nProvider}>
        <PwaInstallBanner />
      </I18nContextProvider>,
    );

    expect(
      screen.getByRole("region", { name: /Instala Savia/i }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Instalar app/i }));

    expect(
      screen.getByText(/Instalar Savia en tu dispositivo/i),
    ).toBeInTheDocument();
  });

  it("calls native prompt when available", async () => {
    const mockPrompt = vi.fn().mockResolvedValue(true);
    mockPwaState({ hasNativePrompt: true, promptInstall: mockPrompt });

    render(
      <I18nContextProvider value={i18nProvider}>
        <PwaInstallBanner />
      </I18nContextProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /Instalar app/i }));

    // promptInstall is async; wait a tick
    await vi.waitFor(() => {
      expect(mockPrompt).toHaveBeenCalledTimes(1);
    });
  });

  it("stays hidden after dismiss", () => {
    mockPwaState();

    const { unmount } = render(
      <I18nContextProvider value={i18nProvider}>
        <PwaInstallBanner />
      </I18nContextProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /Ahora no/i }));
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
    expect(localStorage.getItem(PWA_BANNER_DISMISS_KEY)).not.toBeNull();

    unmount();

    render(
      <I18nContextProvider value={i18nProvider}>
        <PwaInstallBanner />
      </I18nContextProvider>,
    );
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
  });
});
