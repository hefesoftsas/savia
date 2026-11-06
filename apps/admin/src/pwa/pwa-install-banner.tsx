import { useCallback, useState } from "react";
import { Download, X } from "lucide-react";
import { useTranslate } from "ra-core";
import { Button } from "@/components/ui/button";
import { usePwaInstall } from "./use-pwa-install";
import { usePwaInstallAction } from "./use-pwa-install-action";
import { PwaInstallDialog } from "./pwa-install-dialog";
import { cn } from "@/lib/utils";

export const PWA_BANNER_DISMISS_KEY = "savia.pwa.install-banner-dismissed";
export const PWA_BANNER_DISMISS_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function isBannerDismissed(): boolean {
  try {
    const raw = localStorage.getItem(PWA_BANNER_DISMISS_KEY);
    if (!raw) return false;
    return Date.now() - Number(raw) < PWA_BANNER_DISMISS_TTL_MS;
  } catch {
    return false;
  }
}

/**
 * Single automatic PWA entry point. Fixed bottom banner shown when the
 * app is not installed. The user-menu item remains as a manual fallback;
 * both share `usePwaInstallAction` and both self-hide when installed.
 */
export function PwaInstallBanner({ className }: { className?: string }) {
  const translate = useTranslate();
  const { isInstalled, isInstallable } = usePwaInstall();
  const { platform, dialogOpen, setDialogOpen, handleInstall } =
    usePwaInstallAction();
  const [dismissed, setDismissed] = useState(isBannerDismissed);

  const handleDismiss = useCallback(() => {
    try {
      localStorage.setItem(PWA_BANNER_DISMISS_KEY, String(Date.now()));
    } catch {
      // storage unavailable: dismiss for this session only
    }
    setDismissed(true);
  }, []);

  // Never render once installed (or dismissed recently).
  if (isInstalled || !isInstallable || dismissed) {
    return null;
  }

  const title = translate("savia.pwa.bannerTitle", {
    _: "Instala Savia en tu dispositivo",
  });
  const subtitle = translate("savia.pwa.bannerSubtitle", {
    _: "Acceso rápido desde tu pantalla de inicio y pantalla completa.",
  });
  const installLabel = translate("savia.pwa.installAppShort", {
    _: "Instalar app",
  });
  const dismissLabel = translate("savia.pwa.bannerDismiss", {
    _: "Ahora no",
  });

  return (
    <>
      <div
        role="region"
        aria-label={title}
        className={cn(
          "fixed inset-x-3 bottom-3 z-50 sm:inset-x-auto sm:right-6 sm:bottom-6 sm:w-96",
          className,
        )}
      >
        <div className="flex items-center gap-3 rounded-2xl border border-border/70 bg-popover/95 p-3 shadow-xl shadow-black/10 backdrop-blur-md">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Download className="size-5" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-foreground">
              {title}
            </p>
            <p className="line-clamp-2 text-xs text-muted-foreground">
              {subtitle}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button type="button" size="sm" onClick={handleInstall}>
              {installLabel}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8"
              onClick={handleDismiss}
              aria-label={dismissLabel}
              title={dismissLabel}
            >
              <X className="size-4" aria-hidden="true" />
            </Button>
          </div>
        </div>
      </div>

      <PwaInstallDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        platform={platform}
      />
    </>
  );
}
