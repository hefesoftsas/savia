import { useCallback, useEffect, useState } from "react";

export interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: "accepted" | "dismissed";
    platform: string;
  }>;
  prompt(): Promise<void>;
}

export type PwaPlatform =
  | "ios"
  | "android"
  | "mac-safari"
  | "chromium"
  | "other";

export type PwaInstallState = {
  /** True when running inside a browser tab and not yet installed in standalone window. */
  isInstallable: boolean;
  /** True when running in standalone PWA window or home-screen mode. */
  isInstalled: boolean;
  /** True if the browser fired beforeinstallprompt and has a native modal ready. */
  hasNativePrompt: boolean;
  /** Detected browser / OS platform. */
  platform: PwaPlatform;
  /** True on iPhone, iPad, or iPod touch. */
  isIOS: boolean;
  /** Triggers the native browser install prompt if available. Returns true if accepted. */
  promptInstall: () => Promise<boolean>;
};

function checkIsInstalled(): boolean {
  if (typeof window === "undefined") return false;
  const isStandalone = window.matchMedia(
    "(display-mode: standalone)",
  ).matches;
  const isNavigatorStandalone = Boolean(
    (window.navigator as unknown as { standalone?: boolean }).standalone,
  );
  return isStandalone || isNavigatorStandalone;
}

export function detectPwaPlatform(): PwaPlatform {
  if (typeof window === "undefined" || !window.navigator) return "other";
  const ua = window.navigator.userAgent || "";

  if (
    /iPad|iPhone|iPod/.test(ua) &&
    !(window as unknown as { MSStream?: unknown }).MSStream
  ) {
    return "ios";
  }
  if (/Android/i.test(ua)) {
    return "android";
  }
  if (
    /Macintosh|MacIntel|MacPPC|Mac68K/i.test(ua) &&
    /^((?!chrome|android).)*safari/i.test(ua)
  ) {
    return "mac-safari";
  }
  if (/Chrome|Chromium|Edg\//i.test(ua)) {
    return "chromium";
  }
  return "other";
}

// Global reference so that if beforeinstallprompt fired before component mount,
// we don't lose the event.
let deferredPrompt: BeforeInstallPromptEvent | null = null;
const listeners = new Set<(prompt: BeforeInstallPromptEvent | null) => void>();

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredPrompt = event as BeforeInstallPromptEvent;
    for (const listener of listeners) {
      listener(deferredPrompt);
    }
  });

  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    for (const listener of listeners) {
      listener(null);
    }
  });
}

export function usePwaInstall(): PwaInstallState {
  const [isInstalled, setIsInstalled] = useState(checkIsInstalled);
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(
    () => deferredPrompt,
  );
  const [platform] = useState<PwaPlatform>(detectPwaPlatform);

  useEffect(() => {
    const handlePromptChange = (newPrompt: BeforeInstallPromptEvent | null) => {
      setPrompt(newPrompt);
    };

    listeners.add(handlePromptChange);

    const mediaQuery = window.matchMedia("(display-mode: standalone)");
    const handleMediaChange = (e: MediaQueryListEvent) => {
      setIsInstalled(e.matches);
    };

    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener("change", handleMediaChange);
    } else {
      mediaQuery.addListener(handleMediaChange);
    }

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setPrompt(null);
    };

    window.addEventListener("appinstalled", handleAppInstalled);

    return () => {
      listeners.delete(handlePromptChange);
      if (mediaQuery.removeEventListener) {
        mediaQuery.removeEventListener("change", handleMediaChange);
      } else {
        mediaQuery.removeListener(handleMediaChange);
      }
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, []);

  const promptInstall = useCallback(async (): Promise<boolean> => {
    if (!prompt) return false;

    await prompt.prompt();
    const { outcome } = await prompt.userChoice;

    if (outcome === "accepted") {
      setIsInstalled(true);
      deferredPrompt = null;
      setPrompt(null);
      return true;
    }

    return false;
  }, [prompt]);

  const hasNativePrompt = prompt !== null;
  // Always installable if not currently running as an installed standalone app
  const isInstallable = !isInstalled;
  const isIOS = platform === "ios";

  return {
    isInstallable,
    isInstalled,
    hasNativePrompt,
    platform,
    isIOS,
    promptInstall,
  };
}
