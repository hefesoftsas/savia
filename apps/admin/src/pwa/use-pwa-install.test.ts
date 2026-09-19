import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { usePwaInstall } from "./use-pwa-install";

describe("usePwaInstall", () => {
  let mediaQueryListeners: ((e: { matches: boolean }) => void)[] = [];
  let isStandaloneMatch = false;

  beforeEach(() => {
    mediaQueryListeners = [];
    isStandaloneMatch = false;

    vi.spyOn(window, "matchMedia").mockImplementation((query: string) => ({
      matches: query.includes("display-mode: standalone") ? isStandaloneMatch : false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn((_event: string, handler: (e: { matches: boolean }) => void) => {
        mediaQueryListeners.push(handler);
      }),
      removeEventListener: vi.fn((_event: string, handler: (e: { matches: boolean }) => void) => {
        mediaQueryListeners = mediaQueryListeners.filter((h) => h !== handler);
      }),
      dispatchEvent: vi.fn(),
    } as unknown as MediaQueryList));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reports not installed and not installable by default without beforeinstallprompt", () => {
    const { result } = renderHook(() => usePwaInstall());

    expect(result.current.isInstalled).toBe(false);
    expect(result.current.isInstallable).toBe(false);
    expect(result.current.isIOS).toBe(false);
  });

  it("detects when the app is running standalone", () => {
    isStandaloneMatch = true;
    const { result } = renderHook(() => usePwaInstall());

    expect(result.current.isInstalled).toBe(true);
    expect(result.current.isInstallable).toBe(false);
  });

  it("handles beforeinstallprompt event and allows prompting install", async () => {
    const { result } = renderHook(() => usePwaInstall());

    const promptMock = vi.fn().mockResolvedValue(undefined);
    const mockPromptEvent = Object.assign(new Event("beforeinstallprompt"), {
      platforms: ["web"],
      userChoice: Promise.resolve({ outcome: "accepted" as const, platform: "web" }),
      prompt: promptMock,
    });

    act(() => {
      window.dispatchEvent(mockPromptEvent);
    });

    expect(result.current.isInstallable).toBe(true);

    let installResult: boolean | undefined;
    await act(async () => {
      installResult = await result.current.promptInstall();
    });

    expect(promptMock).toHaveBeenCalled();
    expect(installResult).toBe(true);
    expect(result.current.isInstalled).toBe(true);
  });

  it("handles user dismissing the install prompt", async () => {
    const { result } = renderHook(() => usePwaInstall());

    const promptMock = vi.fn().mockResolvedValue(undefined);
    const mockPromptEvent = Object.assign(new Event("beforeinstallprompt"), {
      platforms: ["web"],
      userChoice: Promise.resolve({ outcome: "dismissed" as const, platform: "web" }),
      prompt: promptMock,
    });

    act(() => {
      window.dispatchEvent(mockPromptEvent);
    });

    expect(result.current.isInstallable).toBe(true);

    let installResult: boolean | undefined;
    await act(async () => {
      installResult = await result.current.promptInstall();
    });

    expect(promptMock).toHaveBeenCalled();
    expect(installResult).toBe(false);
    expect(result.current.isInstalled).toBe(false);
  });

  it("updates isInstalled when appinstalled event fires", () => {
    const { result } = renderHook(() => usePwaInstall());

    act(() => {
      window.dispatchEvent(new Event("appinstalled"));
    });

    expect(result.current.isInstalled).toBe(true);
    expect(result.current.isInstallable).toBe(false);
  });
});
