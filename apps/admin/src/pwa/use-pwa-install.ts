import { useCallback, useEffect, useState } from "react";

export interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: "accepted" | "dismissed";
    platform: string;
  }>;
  prompt(): Promise<void>;
}

export type PwaInstallState = {
  isInstallable: boolean;
  isInstalled: boolean;
  isIOS: boolean;
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

function checkIsIOS(): boolean {
  if (typeof window === "undefined" || !window.navigator) return false;
  const userAgent = window.navigator.userAgent || "";
  return (
    /iPad|iPhone|iPod/.test(userAgent) &&
    !(window as unknown as { MSStream?: unknown }).MSStream
  );
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
  const [isIOS] = useState(checkIsIOS);

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

  const isInstallable = !isInstalled && (prompt !== null || isIOS);

  return {
    isInstallable,
    isInstalled,
    isIOS,
    promptInstall,
  };
}
