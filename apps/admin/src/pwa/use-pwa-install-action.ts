import { useCallback, useState } from "react";
import { usePwaInstall } from "./use-pwa-install";

/**
 * Single shared install interaction for every PWA entry point
 * (banner, header, sidebar, user menu).
 *
 * Keeps `beforeinstallprompt` handling in one place so all buttons
 * behave the same: trigger the native prompt when available,
 * otherwise fall back to the manual install dialog.
 */
export function usePwaInstallAction(options: { onAction?: () => void } = {}) {
  const { onAction } = options;
  const { hasNativePrompt, platform, promptInstall } = usePwaInstall();
  const [dialogOpen, setDialogOpen] = useState(false);

  const handleInstall = useCallback(async () => {
    onAction?.();
    if (hasNativePrompt) {
      const accepted = await promptInstall();
      if (!accepted) {
        setDialogOpen(true);
      }
    } else {
      setDialogOpen(true);
    }
  }, [hasNativePrompt, onAction, promptInstall]);

  return {
    platform,
    hasNativePrompt,
    dialogOpen,
    setDialogOpen,
    handleInstall,
  };
}
